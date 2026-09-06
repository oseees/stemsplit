"""Ramble - a RAM-friendly, secure desktop web browser.

The UI is intentionally small. The interesting behaviour is:

* **RAM-friendly:** idle background tabs have their renderer processes destroyed
  (see :mod:`ramble.suspend`) and are rebuilt on demand. A per-window cap limits
  how many renderers can be live at once. Network and disk caches are memory
  capped, and by default the browser runs off-the-record so nothing is written
  to disk.
* **Secure:** a request interceptor blocks ads/trackers and dangerous schemes
  and force-upgrades http to https (see :mod:`ramble.security`); invalid TLS
  certificates are rejected; camera/mic/geolocation permission prompts are
  denied by default; and JavaScript ``window.open`` popups become foreground
  tabs rather than uncontrolled windows.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from PyQt6.QtCore import Qt, QTimer, QUrl, pyqtSignal
from PyQt6.QtGui import QAction, QKeySequence
from PyQt6.QtWebEngineCore import (
    QWebEngineCertificateError,
    QWebEnginePage,
    QWebEngineProfile,
    QWebEngineSettings,
)
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWidgets import (
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QPushButton,
    QStackedWidget,
    QStatusBar,
    QTabWidget,
    QToolBar,
    QVBoxLayout,
    QWidget,
)

from .security import Blocklist, RequestInterceptor
from .suspend import SuspensionPolicy

HOME_URL = "https://duckduckgo.com/"
# Cap the in-memory HTTP cache so the process footprint stays predictable.
HTTP_CACHE_MAX_BYTES = 64 * 1024 * 1024  # 64 MB


@dataclass
class BrowserConfig:
    """Top-level knobs, kept in one place so ``__main__`` can build it."""

    home_url: str = HOME_URL
    https_only: bool = True
    javascript_enabled: bool = True
    private: bool = True  # off-the-record: nothing persisted to disk
    policy: SuspensionPolicy = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.policy is None:
            self.policy = SuspensionPolicy()


def build_profile(config: BrowserConfig, interceptor: RequestInterceptor) -> QWebEngineProfile:
    """Create a hardened, memory-capped web engine profile."""

    # An unnamed profile is off-the-record: cookies, cache and storage live only
    # in memory and vanish on exit. That is both the RAM-friendly and the secure
    # default. A named profile (private=False) persists to disk instead.
    profile = QWebEngineProfile() if config.private else QWebEngineProfile("ramble")

    profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.MemoryHttpCache)
    profile.setHttpCacheMaximumSize(HTTP_CACHE_MAX_BYTES)
    profile.setPersistentCookiesPolicy(
        QWebEngineProfile.PersistentCookiesPolicy.NoPersistentCookies
    )
    profile.setHttpUserAgent(profile.httpUserAgent() + " Ramble/1.0")
    profile.setUrlRequestInterceptor(interceptor)

    settings = profile.settings()
    A = QWebEngineSettings.WebAttribute
    settings.setAttribute(A.JavascriptEnabled, config.javascript_enabled)
    # Security hardening: no auto-opening windows, no clipboard/geolocation reach,
    # no cross-origin local file access, no autoplay of media with sound.
    settings.setAttribute(A.JavascriptCanOpenWindows, True)  # routed to a tab, see RamblePage
    settings.setAttribute(A.JavascriptCanAccessClipboard, False)
    settings.setAttribute(A.LocalContentCanAccessRemoteUrls, False)
    settings.setAttribute(A.LocalContentCanAccessFileUrls, False)
    settings.setAttribute(A.AllowRunningInsecureContent, False)
    settings.setAttribute(A.AllowWindowActivationFromJavaScript, False)
    settings.setAttribute(A.PlaybackRequiresUserGesture, True)
    settings.setAttribute(A.ScreenCaptureEnabled, False)
    if hasattr(A, "ReadingFromCanvasEnabled"):
        settings.setAttribute(A.ReadingFromCanvasEnabled, False)
    return profile


class RamblePage(QWebEnginePage):
    """A page that denies risky permissions and routes popups to new tabs."""

    # Emitted when the page (e.g. via window.open / target=_blank) needs a new
    # view. The window connects this to create a tab and hands back the page.
    popupRequested = pyqtSignal(QWebEnginePage)

    def __init__(self, profile: QWebEngineProfile, parent=None) -> None:
        super().__init__(profile, parent)
        self.featurePermissionRequested.connect(self._deny_feature)

    def _deny_feature(self, origin, feature) -> None:
        # Deny camera, microphone, geolocation, notifications, etc. by default.
        self.setFeaturePermission(
            origin, feature, QWebEnginePage.PermissionPolicy.PermissionDeniedByUser
        )

    def certificateError(self, error: QWebEngineCertificateError) -> bool:  # noqa: N802
        # Reject any invalid/unknown certificate rather than letting the user
        # click through - a secure default.
        return False

    def createWindow(self, _type) -> "QWebEnginePage | None":  # noqa: N802
        new_page = RamblePage(self.profile(), self.parent())
        self.popupRequested.emit(new_page)
        return new_page


class BrowserTab(QStackedWidget):
    """One tab. Holds a live ``QWebEngineView`` or a lightweight placeholder.

    When suspended, the view (and its renderer process) is destroyed and only
    the cached title/url remain, backed by a small placeholder widget. Resuming
    rebuilds the view and reloads the last URL.
    """

    titleChanged = pyqtSignal(object)
    urlChanged = pyqtSignal(object)
    loadingChanged = pyqtSignal(object, bool)
    securityChanged = pyqtSignal(object)

    def __init__(self, profile: QWebEngineProfile, config: BrowserConfig, window: "BrowserWindow") -> None:
        super().__init__()
        self._profile = profile
        self._config = config
        self._window = window

        self.url = QUrl(config.home_url)
        self.title = "New Tab"
        self.last_active = time.monotonic()
        self.suspended = False

        self._placeholder = self._build_placeholder()
        self.addWidget(self._placeholder)  # index 0

        self.view: QWebEngineView | None = None
        self._ensure_view()

    # -- placeholder ---------------------------------------------------------
    def _build_placeholder(self) -> QWidget:
        widget = QWidget()
        layout = QVBoxLayout(widget)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._placeholder_label = QLabel("Tab suspended to save memory")
        self._placeholder_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._placeholder_label.setStyleSheet("color: #666; font-size: 15px;")
        button = QPushButton("Reload this tab")
        button.clicked.connect(self.resume)
        button.setFixedWidth(160)
        layout.addWidget(self._placeholder_label)
        layout.addSpacing(10)
        layout.addWidget(button, alignment=Qt.AlignmentFlag.AlignCenter)
        return widget

    # -- view lifecycle ------------------------------------------------------
    def _ensure_view(self) -> None:
        if self.view is not None:
            return
        view = QWebEngineView()
        page = RamblePage(self._profile, view)
        page.popupRequested.connect(self._window.adopt_popup_page)
        view.setPage(page)

        view.titleChanged.connect(self._on_title)
        view.urlChanged.connect(self._on_url)
        view.loadStarted.connect(lambda: self.loadingChanged.emit(self, True))
        view.loadFinished.connect(lambda ok: self.loadingChanged.emit(self, False))

        self.view = view
        self.addWidget(view)  # index 1
        self.setCurrentWidget(view)

    def load(self, url: QUrl) -> None:
        self._ensure_view()
        self.url = url
        self.touch()
        assert self.view is not None
        self.view.setUrl(url)

    def touch(self) -> None:
        """Mark this tab as just used (resets its idle timer)."""

        self.last_active = time.monotonic()

    # -- suspend / resume ----------------------------------------------------
    def suspend(self) -> None:
        if self.suspended or self.view is None:
            return
        self.url = self.view.url() if not self.view.url().isEmpty() else self.url
        self.title = self.view.title() or self.title
        self._placeholder_label.setText(f"“{self.title}” suspended to save memory")

        view = self.view
        self.view = None
        self.suspended = True
        self.setCurrentWidget(self._placeholder)
        self.removeWidget(view)
        page = view.page()
        view.setPage(None)  # detach so deleting the view tears down the renderer
        if page is not None:
            page.deleteLater()
        view.deleteLater()

    def resume(self) -> None:
        if not self.suspended:
            return
        self.suspended = False
        self._ensure_view()
        self.touch()
        assert self.view is not None
        self.view.setUrl(self.url)

    # -- view signal handlers ------------------------------------------------
    def _on_title(self, title: str) -> None:
        self.title = title or self.title
        self.titleChanged.emit(self)

    def _on_url(self, url: QUrl) -> None:
        self.url = url
        self.urlChanged.emit(self)
        self.securityChanged.emit(self)


class BrowserWindow(QMainWindow):
    """The main window: toolbar, tab strip, and the suspension sweep timer."""

    def __init__(self, config: BrowserConfig | None = None) -> None:
        super().__init__()
        self.config = config or BrowserConfig()
        self.blocklist = Blocklist.load()
        self.interceptor = RequestInterceptor(self.blocklist, https_only=self.config.https_only)
        self.profile = build_profile(self.config, self.interceptor)

        self.setWindowTitle("Ramble")
        self.resize(1100, 760)

        self._build_toolbar()
        self._build_tabs()
        self._build_statusbar()

        # Sweep for idle/over-budget tabs on a fixed cadence.
        self._sweep_timer = QTimer(self)
        self._sweep_timer.timeout.connect(self._sweep_tabs)
        self._sweep_timer.start(15_000)  # every 15s

        self._stats_timer = QTimer(self)
        self._stats_timer.timeout.connect(self._update_statusbar)
        self._stats_timer.start(2_000)

        self.add_tab(QUrl(self.config.home_url))

    # -- construction --------------------------------------------------------
    def _build_toolbar(self) -> None:
        bar = QToolBar("Navigation")
        bar.setMovable(False)
        self.addToolBar(bar)

        self._act_back = QAction("‹", self)
        self._act_back.setToolTip("Back")
        self._act_back.triggered.connect(lambda: self._current_view_call("back"))
        bar.addAction(self._act_back)

        self._act_forward = QAction("›", self)
        self._act_forward.setToolTip("Forward")
        self._act_forward.triggered.connect(lambda: self._current_view_call("forward"))
        bar.addAction(self._act_forward)

        self._act_reload = QAction("⟳", self)
        self._act_reload.setToolTip("Reload")
        self._act_reload.triggered.connect(lambda: self._current_view_call("reload"))
        bar.addAction(self._act_reload)

        self._lock = QLabel(" ")
        self._lock.setToolTip("Connection security")
        bar.addWidget(self._lock)

        self.address = QLineEdit()
        self.address.setClearButtonEnabled(True)
        self.address.setPlaceholderText("Search DuckDuckGo or enter a URL")
        self.address.returnPressed.connect(self._navigate_from_address)
        bar.addWidget(self.address)

        new_tab = QAction("+", self)
        new_tab.setToolTip("New tab")
        new_tab.setShortcut(QKeySequence.StandardKey.AddTab)
        new_tab.triggered.connect(lambda: self.add_tab(QUrl(self.config.home_url)))
        bar.addAction(new_tab)

        self._js_toggle = QCheckBox("JS")
        self._js_toggle.setToolTip("Enable JavaScript for new tabs")
        self._js_toggle.setChecked(self.config.javascript_enabled)
        self._js_toggle.stateChanged.connect(self._toggle_javascript)
        bar.addWidget(self._js_toggle)

        # A quick keyboard shortcut to close the current tab.
        close_sc = QAction(self)
        close_sc.setShortcut(QKeySequence.StandardKey.Close)
        close_sc.triggered.connect(lambda: self._close_tab(self.tabs.currentIndex()))
        self.addAction(close_sc)

    def _build_tabs(self) -> None:
        self.tabs = QTabWidget()
        self.tabs.setTabsClosable(True)
        self.tabs.setMovable(True)
        self.tabs.setDocumentMode(True)
        self.tabs.tabCloseRequested.connect(self._close_tab)
        self.tabs.currentChanged.connect(self._on_tab_changed)
        self.setCentralWidget(self.tabs)

    def _build_statusbar(self) -> None:
        self.setStatusBar(QStatusBar())
        self._status = QLabel()
        self.statusBar().addPermanentWidget(self._status)

    # -- tab management ------------------------------------------------------
    def add_tab(self, url: QUrl, background: bool = False) -> BrowserTab:
        tab = BrowserTab(self.profile, self.config, self)
        tab.titleChanged.connect(self._refresh_tab_label)
        tab.urlChanged.connect(self._on_tab_url_changed)
        tab.securityChanged.connect(self._on_tab_url_changed)
        index = self.tabs.addTab(tab, "New Tab")
        if not background:
            self.tabs.setCurrentIndex(index)
        tab.load(url)
        return tab

    def adopt_popup_page(self, page: QWebEnginePage) -> None:
        """Host a popup/target=_blank page created by an existing tab."""

        tab = BrowserTab(self.profile, self.config, self)
        # Replace the freshly-built view's page with the one Qt handed us so the
        # navigation the page already started lands in this tab.
        if tab.view is not None:
            old = tab.view.page()
            tab.view.setPage(page)
            page.popupRequested.connect(self.adopt_popup_page)
            page.titleChanged.connect(lambda t, _t=tab: _t._on_title(t))
            page.urlChanged.connect(lambda u, _t=tab: _t._on_url(u))
            if old is not None:
                old.deleteLater()
        tab.titleChanged.connect(self._refresh_tab_label)
        tab.urlChanged.connect(self._on_tab_url_changed)
        index = self.tabs.addTab(tab, "New Tab")
        self.tabs.setCurrentIndex(index)

    def _close_tab(self, index: int) -> None:
        if index < 0:
            return
        tab = self.tabs.widget(index)
        self.tabs.removeTab(index)
        if isinstance(tab, BrowserTab) and tab.view is not None:
            tab.view.setPage(None)
        if tab is not None:
            tab.deleteLater()
        if self.tabs.count() == 0:
            self.add_tab(QUrl(self.config.home_url))

    def _current_tab(self) -> BrowserTab | None:
        widget = self.tabs.currentWidget()
        return widget if isinstance(widget, BrowserTab) else None

    def _current_view_call(self, method: str) -> None:
        tab = self._current_tab()
        if tab is None:
            return
        if tab.suspended:
            tab.resume()
            return
        if tab.view is not None:
            getattr(tab.view, method)()

    # -- navigation ----------------------------------------------------------
    def _navigate_from_address(self) -> None:
        tab = self._current_tab()
        if tab is None:
            return
        tab.load(self._interpret_address(self.address.text()))

    @staticmethod
    def _interpret_address(text: str) -> QUrl:
        """Turn arbitrary address-bar text into a URL or a search query."""

        text = text.strip()
        if not text:
            return QUrl(HOME_URL)
        if "://" in text:
            return QUrl(text)
        # Looks like a bare domain (has a dot, no spaces) -> treat as https URL.
        if " " not in text and "." in text:
            return QUrl("https://" + text)
        query = QUrl("https://duckduckgo.com/")
        query.setQuery("q=" + QUrl.toPercentEncoding(text).data().decode())
        return query

    # -- signal handlers -----------------------------------------------------
    def _on_tab_changed(self, index: int) -> None:
        tab = self._current_tab()
        if tab is None:
            return
        if tab.suspended:
            tab.resume()
        tab.touch()
        self._on_tab_url_changed(tab)

    def _on_tab_url_changed(self, tab: BrowserTab) -> None:
        if tab is not self._current_tab():
            return
        self.address.setText(tab.url.toString())
        secure = tab.url.scheme() == "https"
        self._lock.setText(" 🔒 " if secure else " ⚠ ")
        self._lock.setToolTip("Secure (HTTPS)" if secure else "Not secure")

    def _refresh_tab_label(self, tab: BrowserTab) -> None:
        index = self.tabs.indexOf(tab)
        if index < 0:
            return
        label = tab.title if len(tab.title) <= 24 else tab.title[:23] + "…"
        self.tabs.setTabText(index, label or "New Tab")
        self.tabs.setTabToolTip(index, tab.title)
        if tab is self._current_tab():
            self._on_tab_url_changed(tab)

    def _toggle_javascript(self, state: int) -> None:
        enabled = state == Qt.CheckState.Checked.value
        self.config.javascript_enabled = enabled
        self.profile.settings().setAttribute(
            QWebEngineSettings.WebAttribute.JavascriptEnabled, enabled
        )

    # -- suspension sweep ----------------------------------------------------
    def _iter_tabs(self):
        for i in range(self.tabs.count()):
            widget = self.tabs.widget(i)
            if isinstance(widget, BrowserTab):
                yield widget

    def _sweep_tabs(self) -> None:
        policy = self.config.policy
        current = self._current_tab()
        now = time.monotonic()

        # 1) Suspend tabs idle beyond the threshold.
        for tab in self._iter_tabs():
            if tab is current or tab.suspended or tab.view is None:
                continue
            if policy.should_suspend_idle(tab.last_active, is_current=False, now=now):
                tab.suspend()

        # 2) Enforce the live-renderer cap, oldest first.
        live = [t for t in self._iter_tabs() if not t.suspended and t is not current]
        surplus = policy.surplus(len(live) + (1 if current else 0))
        if surplus > 0:
            for tab in sorted(live, key=lambda t: t.last_active)[:surplus]:
                tab.suspend()

    def _update_statusbar(self) -> None:
        live = sum(1 for t in self._iter_tabs() if not t.suspended)
        suspended = sum(1 for t in self._iter_tabs() if t.suspended)
        self._status.setText(
            f"Tabs: {live} live · {suspended} suspended    "
            f"Blocked: {self.interceptor.blocked_count}    "
            f"HTTPS upgrades: {self.interceptor.upgraded_count}"
        )
