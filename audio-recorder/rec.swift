// Mac Audio Recorder — records the audio playing on this Mac (not the mic) to
// ~/Music/Mac Recordings/*.wav, with a Voice-Memos-style UI.
// ponytail: ScreenCaptureKit, not BlackHole — no driver, no sudo, no rerouting the user's
// output device. Ships as an .app bundle because only a bundle can hold its own TCC grant.
import AppKit
import AVFoundation
import Carbon.HIToolbox  // global hotkey (RegisterEventHotKey)
import ScreenCaptureKit
import Vision            // OCR Splice's key/BPM off its window

// Single instance — the C hotkey callback can't capture context, so it reaches the app here.
weak var sharedRecorder: Recorder?

let outputDir = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Music/Mac Recordings")
let ink = NSColor(white: 0.07, alpha: 1)

// MARK: - Waveform

/// Rolling peak display: the only feedback that proves audio is actually arriving.
final class WaveView: NSView {
    private var levels = [CGFloat](repeating: 0, count: 90)
    var active = false { didSet { needsDisplay = true } }

    func push(_ peak: CGFloat) {
        DispatchQueue.main.async {
            self.levels.removeFirst()
            self.levels.append(peak)
            self.needsDisplay = true
        }
    }

    func reset() {
        levels = [CGFloat](repeating: 0, count: levels.count)
        needsDisplay = true
    }

    override func draw(_: NSRect) {
        let step = bounds.width / CGFloat(levels.count)
        let barW = max(2, step - 2)
        (active ? NSColor.systemRed : NSColor(white: 1, alpha: 0.22)).setFill()
        for (i, v) in levels.enumerated() {
            let h = max(3, v * (bounds.height - 10))
            let r = NSRect(x: CGFloat(i) * step, y: (bounds.height - h) / 2, width: barW, height: h)
            NSBezierPath(roundedRect: r, xRadius: barW / 2, yRadius: barW / 2).fill()
        }
    }
}

// MARK: - Record button

final class RecordButton: NSView {
    var recording = false { didSet { needsDisplay = true } }
    var onClick: () -> Void = {}

    override func draw(_: NSRect) {
        NSColor(white: 1, alpha: 0.35).setStroke()
        let ring = NSBezierPath(ovalIn: bounds.insetBy(dx: 2, dy: 2))
        ring.lineWidth = 3
        ring.stroke()

        NSColor.systemRed.setFill()
        if recording {
            let side = bounds.width * 0.36
            let r = NSRect(x: bounds.midX - side / 2, y: bounds.midY - side / 2, width: side, height: side)
            NSBezierPath(roundedRect: r, xRadius: 5, yRadius: 5).fill()
        } else {
            NSBezierPath(ovalIn: bounds.insetBy(dx: 8, dy: 8)).fill()
        }
    }

    override func mouseDown(with _: NSEvent) { onClick() }
    // Fire on the very first click even when the (floating) window isn't yet key — otherwise
    // that click is spent just activating the window and the user has to click twice.
    override func acceptsFirstMouse(for _: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
}

// Subtle rounded panel behind the options — refined without NSBox's contentView sizing quirks.
final class Card: NSView {
    override func draw(_: NSRect) {
        let p = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
        NSColor(white: 1, alpha: 0.045).setFill(); p.fill()
        NSColor(white: 1, alpha: 0.09).setStroke(); p.lineWidth = 1; p.stroke()
    }
}

// MARK: - App

final class Recorder: NSObject, NSApplicationDelegate, SCStreamOutput, SCStreamDelegate, NSTableViewDataSource, NSTableViewDelegate {
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 380, height: 580),
                          styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
    let wave = WaveView()
    let recordButton = RecordButton()
    let timeLabel = NSTextField(labelWithString: "00:00")
    let hint = NSTextField(labelWithString: "Records whatever is playing on this Mac")
    let trimBox = NSButton(checkboxWithTitle: "Trim silence at start & end", target: nil, action: nil)
    let normalizeBox = NSButton(checkboxWithTitle: "Normalize to −1 dB", target: nil, action: nil)
    let autoBox = NSButton(checkboxWithTitle: "Auto-record on sound (hands-free)", target: nil, action: nil)
    let spliceTagBox = NSButton(checkboxWithTitle: "Tag key & BPM from Splice", target: nil, action: nil)
    let grabBox = NSButton(checkboxWithTitle: "Grab the file from Splice when possible", target: nil, action: nil)
    let permissionBox = NSStackView()

    // Global hotkey ⌥⌘R.
    var hotKeyRef: EventHotKeyRef?
    var grabKeyRef: EventHotKeyRef?
    // Auto-record ("VOX") state — touched only on the audio queue.
    let audioQueue = DispatchQueue(label: "audio")
    var autoMode = false
    var writing = false
    var silenceFrames = 0
    var preRoll: [AVAudioPCMBuffer] = []
    var clipURL: URL?
    var doTrim = true
    var doNormalize = true
    var doSpliceTag = true
    let table = NSTableView()
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

    var stream: SCStream?
    // Held only while recording: stops macOS App Nap from throttling/suspending us when we're
    // backgrounded behind the DAW (which starved the SCStream and killed it at ~30 s), and keeps
    // the display awake so screen capture isn't torn down mid-take.
    var activity: NSObjectProtocol?
    var file: AVAudioFile?
    var startedAt: Date?
    var timer: Timer?
    var lastURL: URL?
    var files: [URL] = []
    var player: AVAudioPlayer?
    var playingRow: Int?

    // MARK: Layout

    func applicationDidFinishLaunching(_: Notification) {
        window.title = "Mac Audio Recorder"
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = ink
        // Default for code-created windows is true: the red close button would DEALLOC the
        // window, so "Show Window" / Dock-reopen has nothing to bring back. Just hide it.
        window.isReleasedWhenClosed = false
        window.level = .floating  // stays above other apps' windows instead of hiding behind them
        window.contentView = buildUI()
        window.setContentSize(NSSize(width: 380, height: 620))
        window.minSize = NSSize(width: 380, height: 580)
        // Remember wherever you park it — it re-centred on every launch before, which undid
        // whatever spot you'd chosen next to the DAW.
        window.setFrameAutosaveName("MacAudioRecorderMain")
        if !window.setFrameUsingName("MacAudioRecorderMain") { window.center() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        statusItem.button?.title = "🎙"
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show Window", action: #selector(showWindow), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        menu.items.forEach { if $0.target == nil { $0.target = self } }
        statusItem.menu = menu

        sharedRecorder = self
        registerHotKey()
        refreshHint()

        reloadFiles()
        // Ask at launch: the grant only takes effect in a freshly launched process, so the
        // sooner it is requested the sooner the app is usable.
        _ = hasPermission()

        let a = CommandLine.arguments  // headless check: --cli <file> <seconds>
        if a.count == 3, a[1] == "--trim" {  // trim + normalize an existing file in place, then exit
            process(URL(fileURLWithPath: a[2]), trim: true, normalize: true)
            exit(0)
        }
        if a.count == 3, a[1] == "--splicetag" {  // parse key/BPM from a Splice screenshot, then exit
            let cg = NSImage(contentsOfFile: a[2])?.cgImage(forProposedRect: nil, context: nil, hints: nil)
            let hit = cg.flatMap { Recorder.parseSpliceTag($0) }
            print("name=\(hit?.name ?? "nil") tag=\(hit?.tag ?? "nil")")
            exit(0)
        }
        if a.count >= 2, a[1] == "--nowplaying" {  // print the last sample Splice played, then exit
            print(nowPlayingFile(within: a.count > 2 ? (Double(a[2]) ?? .infinity) : .infinity)?.path ?? "nil")
            exit(0)
        }
        if a.count == 4, a[1] == "--cli" {
            start(to: URL(fileURLWithPath: a[2]))
            DispatchQueue.main.asyncAfter(deadline: .now() + (Double(a[3]) ?? 5)) {
                self.stop { NSApp.terminate(nil) }
            }
        }
    }

    func buildUI() -> NSView {
        wave.translatesAutoresizingMaskIntoConstraints = false
        wave.heightAnchor.constraint(equalToConstant: 90).isActive = true
        // Without a width floor the constraint-based content view collapses the whole
        // window to a sliver: every subview is happy at zero width.
        wave.widthAnchor.constraint(greaterThanOrEqualToConstant: 340).isActive = true

        timeLabel.font = .monospacedDigitSystemFont(ofSize: 48, weight: .ultraLight)
        timeLabel.textColor = .white
        timeLabel.alignment = .center

        hint.font = .systemFont(ofSize: 11)
        hint.textColor = NSColor(white: 1, alpha: 0.45)
        hint.alignment = .center
        hint.lineBreakMode = .byTruncatingTail

        recordButton.translatesAutoresizingMaskIntoConstraints = false
        recordButton.widthAnchor.constraint(equalToConstant: 62).isActive = true
        recordButton.heightAnchor.constraint(equalToConstant: 62).isActive = true
        recordButton.onClick = { [weak self] in self?.toggle() }
        let buttonRow = NSStackView(views: [recordButton])

        // Options persist across launches (defaults apply only on a first run): trim + normalize +
        // Splice tagging on, hands-free opt-in.
        let d = UserDefaults.standard
        d.register(defaults: ["trim": true, "normalize": true, "spliceTag": true, "auto": false, "grab": true])
        for box in [trimBox, normalizeBox, spliceTagBox, autoBox, grabBox] {
            box.font = .systemFont(ofSize: 11)
            box.target = self
            box.action = #selector(saveOptions)
        }
        grabBox.state = d.bool(forKey: "grab") ? .on : .off
        trimBox.state = d.bool(forKey: "trim") ? .on : .off
        normalizeBox.state = d.bool(forKey: "normalize") ? .on : .off
        spliceTagBox.state = d.bool(forKey: "spliceTag") ? .on : .off
        autoBox.state = d.bool(forKey: "auto") ? .on : .off

        // Only shown when the Screen Recording grant is missing.
        let permLabel = NSTextField(labelWithString: "Allow “Mac Audio Recorder” under Screen &\nSystem Audio Recording, then reopen.")
        permLabel.font = .systemFont(ofSize: 11)
        permLabel.textColor = .systemOrange
        permLabel.alignment = .center
        permLabel.maximumNumberOfLines = 2
        let permButtons = NSStackView(views: [
            NSButton(title: "Open Settings", target: self, action: #selector(openSettings)),
            NSButton(title: "Quit & Reopen", target: self, action: #selector(reopen)),
        ])
        permissionBox.orientation = .vertical
        permissionBox.spacing = 6
        permissionBox.addArrangedSubview(permLabel)
        permissionBox.addArrangedSubview(permButtons)
        permissionBox.isHidden = true

        table.headerView = nil
        table.backgroundColor = .clear
        table.rowHeight = 42
        table.gridStyleMask = []
        table.style = .plain
        table.dataSource = self
        table.delegate = self
        table.target = self
        table.action = #selector(rowClicked)
        table.addTableColumn(NSTableColumn(identifier: .init("main")))
        // Drag a row straight into a DAW / Finder: the row hands over the file URL.
        table.setDraggingSourceOperationMask([.copy], forLocal: false)
        // Right-click a recording to rename or trash it.
        let rowMenu = NSMenu()
        rowMenu.addItem(NSMenuItem(title: "Rename…", action: #selector(renameRow), keyEquivalent: ""))
        rowMenu.addItem(NSMenuItem(title: "Delete", action: #selector(deleteRow), keyEquivalent: ""))
        rowMenu.items.forEach { $0.target = self }
        table.menu = rowMenu

        let scroll = NSScrollView()
        scroll.documentView = table
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 190).isActive = true

        let listHeader = NSTextField(labelWithString: "RECORDINGS")
        listHeader.font = .systemFont(ofSize: 10, weight: .semibold)
        listHeader.textColor = NSColor(white: 1, alpha: 0.4)
        let folder = NSButton(title: "Open Folder", target: self, action: #selector(openFolder))
        folder.isBordered = false
        folder.contentTintColor = .systemBlue
        let headerRow = NSStackView(views: [listHeader, folder])
        headerRow.orientation = .horizontal
        headerRow.distribution = .equalSpacing

        let W: CGFloat = 340  // content width; full-width members share this one edge

        // Options grouped in a subtle card.
        let cardStack = NSStackView(views: [grabBox, trimBox, normalizeBox, spliceTagBox, autoBox])
        cardStack.orientation = .vertical
        cardStack.alignment = .leading
        cardStack.spacing = 9
        cardStack.translatesAutoresizingMaskIntoConstraints = false

        // Custom rounded panel; cardStack pinned inside with padding so the card sizes to it.
        let card = Card()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(cardStack)
        NSLayoutConstraint.activate([
            card.widthAnchor.constraint(equalToConstant: W),
            cardStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            cardStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -14),
            cardStack.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            cardStack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
        ])

        let listDivider = hairline()
        let stack = NSStackView(views: [wave, timeLabel, hint, buttonRow, card, permissionBox,
                                        listDivider, headerRow, scroll])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 18, right: 20)
        for v in [listDivider, headerRow, scroll] {
            v.widthAnchor.constraint(equalToConstant: W).isActive = true
        }
        // Tighten the vertical rhythm: hint hugs the timer, generous air around the button.
        stack.setCustomSpacing(2, after: timeLabel)
        stack.setCustomSpacing(18, after: hint)
        stack.setCustomSpacing(18, after: buttonRow)
        stack.setCustomSpacing(16, after: card)
        return stack
    }

    // 1px hairline; caller pins its width.
    func hairline() -> NSView {
        let v = NSView()
        v.wantsLayer = true
        v.layer?.backgroundColor = NSColor(white: 1, alpha: 0.1).cgColor
        v.translatesAutoresizingMaskIntoConstraints = false
        v.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return v
    }


    // MARK: Instant grab

    /// Splice plays a downloaded sample by fetching it from its own localhost HTTP server, so its
    /// Chromium cache holds one entry per played file keyed by the real path. The newest such entry
    /// is the last thing played — copying it beats recording: instant, full quality, original name.
    ///
    /// A sample you haven't downloaded streams instead, as `audio_samples/<hash>-scrambled/…mp3`,
    /// and is NOT on disk. So a local hit only counts when nothing has streamed since: preview a
    /// downloaded loop and then an undownloaded one and the stale local entry is still the newest
    /// *local* one — it would be grabbed in place of the stream you actually meant to record.
    func nowPlayingFile(within: TimeInterval = .infinity) -> URL? {
        let cutoff = Date().addingTimeInterval(-within)
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/Application Support/com.splice.Splice/Cache/Cache_Data")
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return nil }
        let newest = names.compactMap { n -> (String, Date)? in
            guard let m = (try? FileManager.default.attributesOfItem(atPath: dir.appending(path: n).path))?[.modificationDate] as? Date
            else { return nil }
            return (n, m)
        }.sorted { $0.1 > $1.1 }
        let re = try! NSRegularExpression(
            pattern: "http://127\\.0\\.0\\.1:[0-9]+/[^/]+/file/(/[^\"\\s]+?\\.(wav|aiff|aif|mp3|flac|ogg))",
            options: .caseInsensitive)
        // A streamed preview. Waveform (.wv.json) fetches aren't plays, so require "-scrambled".
        let streamRE = try! NSRegularExpression(pattern: "audio_samples/[0-9a-f]+-scrambled",
                                                options: .caseInsensitive)
        // ponytail: 400 newest entries is ~an hour of browsing; widen if a grab ever comes up empty.
        for (n, mtime) in newest.prefix(400) {
            if mtime < cutoff { return nil }  // sorted newest-first, so everything past here is older
            guard let h = FileHandle(forReadingAtPath: dir.appending(path: n).path) else { continue }
            defer { try? h.close() }
            guard let d = try? h.read(upToCount: 2048),
                  let s = String(data: d, encoding: .isoLatin1) else { continue }
            let all = NSRange(s.startIndex..., in: s)
            if let m = re.firstMatch(in: s, range: all), let r = Range(m.range(at: 1), in: s) {
                let path = String(s[r]).removingPercentEncoding ?? String(s[r])
                if FileManager.default.fileExists(atPath: path) { return URL(fileURLWithPath: path) }
            } else if streamRE.firstMatch(in: s, range: all) != nil {
                return nil  // most recent play was a stream — nothing to copy, record it
            }
        }
        return nil
    }

    @objc func grab() {
        guard let src = nowPlayingFile() else {
            hint.stringValue = "Not on disk — record it instead (⌥⌘R)"
            return
        }
        let base = src.deletingPathExtension().lastPathComponent, ext = src.pathExtension
        let size = (try? FileManager.default.attributesOfItem(atPath: src.path))?[.size] as? Int
        var dest = outputDir.appending(path: src.lastPathComponent), n = 2
        while FileManager.default.fileExists(atPath: dest.path) {
            // Already grabbed, byte-for-byte? Hitting record twice on one sample shouldn't litter
            // the folder with identical copies — point at the one that's there.
            if size != nil, (try? FileManager.default.attributesOfItem(atPath: dest.path))?[.size] as? Int == size {
                lastURL = dest
                hint.stringValue = "Already have \(dest.lastPathComponent)"
                return
            }
            dest = outputDir.appending(path: "\(base) \(n).\(ext)"); n += 1
        }
        do {
            try FileManager.default.copyItem(at: src, to: dest)
            // copyItem preserves the pack's original mtime, which would bury it at the bottom of
            // the list; the list is newest-first, so stamp it as just-made.
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: dest.path)
            lastURL = dest
            hint.stringValue = "Grabbed \(dest.lastPathComponent)"
            reloadFiles()
        } catch {
            hint.stringValue = "Copy failed: \(error.localizedDescription)"
        }
    }

    // MARK: Features

    // Global ⌥⌘R — start/stop from any app without leaving the DAW. Carbon hotkey needs no
    // Accessibility permission and works while another app is frontmost.
    func registerHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, evt, _ -> OSStatus in
            var hk = EventHotKeyID()
            GetEventParameter(evt, OSType(kEventParamDirectObject), OSType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
            let grab = hk.id == 2
            DispatchQueue.main.async { grab ? sharedRecorder?.grab() : sharedRecorder?.toggle() }
            return noErr
        }, 1, &spec, nil, nil)
        let sig = OSType(0x4d524543) /* 'MREC' */
        RegisterEventHotKey(UInt32(kVK_ANSI_R), UInt32(optionKey | cmdKey),
                            EventHotKeyID(signature: sig, id: 1), GetApplicationEventTarget(), 0, &hotKeyRef)
        RegisterEventHotKey(UInt32(kVK_ANSI_G), UInt32(optionKey | cmdKey),
                            EventHotKeyID(signature: sig, id: 2), GetApplicationEventTarget(), 0, &grabKeyRef)
    }

    // Any checkbox change writes straight through, so the app comes back exactly as you left it.
    @objc func saveOptions() {
        let d = UserDefaults.standard
        d.set(grabBox.state == .on, forKey: "grab")
        d.set(trimBox.state == .on, forKey: "trim")
        d.set(normalizeBox.state == .on, forKey: "normalize")
        d.set(spliceTagBox.state == .on, forKey: "spliceTag")
        d.set(autoBox.state == .on, forKey: "auto")
        refreshHint()
    }

    @objc func refreshHint() {
        guard stream == nil else { return }
        hint.stringValue = autoBox.state == .on
            ? "Armed on click — a clip per sound. ⌥⌘R"
            : "Records whatever is playing on this Mac. ⌥⌘R"
    }

    // MARK: Permission

    // macOS only applies a new Screen Recording grant to a *freshly launched* process, so
    // asking is a two-step dance: prompt, then relaunch.
    func hasPermission() -> Bool {
        if CGPreflightScreenCaptureAccess() {
            permissionBox.isHidden = true
            return true
        }
        CGRequestScreenCaptureAccess()
        permissionBox.isHidden = false
        hint.stringValue = "Screen & System Audio Recording permission needed"
        return false
    }

    @objc func openSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
    }

    @objc func reopen() {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        p.arguments = ["-n", Bundle.main.bundlePath]
        try? p.run()
        NSApp.terminate(nil)
    }

    @objc func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func openFolder() {
        try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
        NSWorkspace.shared.selectFile(lastURL?.path, inFileViewerRootedAtPath: outputDir.path)
    }

    func applicationShouldHandleReopen(_: NSApplication, hasVisibleWindows _: Bool) -> Bool {
        showWindow()
        return true
    }

    // MARK: Recording

    func toggle() {
        guard stream == nil else { return stop() }
        // One button: if Splice just played a sample that's already on disk, copying it beats
        // recording it. Only a play from the last 2 minutes counts, so a stale cache entry from
        // an earlier session can't hijack a take you actually meant to record.
        if grabBox.state == .on, nowPlayingFile(within: 120) != nil { return grab() }
        start(to: nil)
    }

    func newDest() -> URL {
        try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
        let stamp = DateFormatter()
        stamp.dateFormat = "MMM d, HH.mm.ss"
        return outputDir.appending(path: "\(stamp.string(from: Date())).wav")
    }

    // ponytail: WAV via AVAudioFile — 16-bit PCM opens in every DAW and editor.
    func makeFile(_ url: URL) throws -> AVAudioFile {
        try AVAudioFile(forWriting: url, settings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 48000,
            AVNumberOfChannelsKey: 2,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ])
    }

    func start(to url: URL?) {
        guard hasPermission() else { return }
        doTrim = trimBox.state == .on
        doNormalize = normalizeBox.state == .on
        doSpliceTag = spliceTagBox.state == .on
        let auto = url == nil && autoBox.state == .on
        Task { @MainActor in
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard let display = content.displays.first else { return fail("No display found.") }
                let cfg = SCStreamConfiguration()
                cfg.capturesAudio = true
                cfg.sampleRate = 48000
                cfg.channelCount = 2
                cfg.excludesCurrentProcessAudio = true
                // ponytail: SCStream always wants a video config; 2x2 at 1fps is the cheapest
                // legal one, and we simply never add a screen output.
                cfg.width = 2
                cfg.height = 2
                cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
                // Whole-system audio. A per-app `including:` filter looks appealing but silently
                // fails for multi-process apps (Splice, browsers, Discord — all Electron): the
                // audio is emitted by helper subprocesses, not the main app object, so it captures
                // nothing. System-wide is the only filter that reliably records what you hear.
                let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
                let s = SCStream(filter: filter, configuration: cfg, delegate: self)
                try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
                try await s.startCapture()

                stream = s
                activity = ProcessInfo.processInfo.beginActivity(
                    options: [.userInitiated, .idleDisplaySleepDisabled],
                    reason: "Recording system audio")
                autoMode = auto
                writing = false
                silenceFrames = 0
                preRoll = []
                clipURL = nil
                wave.active = true
                recordButton.recording = true
                timer = .scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.tick() }
                if auto {
                    lastURL = nil
                    startedAt = nil
                    statusItem.button?.title = "👂"
                    hint.stringValue = "Listening — play something…"
                } else {
                    let dest = url ?? newDest()
                    file = try makeFile(dest)
                    clipURL = dest
                    lastURL = dest
                    startedAt = Date()
                    hint.stringValue = dest.lastPathComponent
                }
                tick()
            } catch {
                file = nil
                fail(error.localizedDescription)
            }
        }
    }

    // Quitting mid-recording would otherwise leave an m4a with no moov atom: unplayable.
    func applicationWillTerminate(_: Notification) { file = nil }

    func stop(then done: (() -> Void)? = nil) {
        Task { @MainActor in
            try? await stream?.stopCapture()
            stream = nil
            if let activity { ProcessInfo.processInfo.endActivity(activity); self.activity = nil }
            let hadClip = file != nil          // normal take, or an auto clip caught mid-write
            let url = clipURL
            file = nil                          // flush/close
            writing = false
            autoMode = false
            preRoll = []
            timer?.invalidate()
            startedAt = nil
            wave.active = false
            wave.reset()
            recordButton.recording = false
            timeLabel.stringValue = "00:00"
            statusItem.button?.title = "🎙"
            hint.stringValue = (url ?? lastURL).map { "Saved \($0.lastPathComponent)" } ?? "Records whatever is playing on this Mac"
            reloadFiles()
            if hadClip, let url { finalize(url) }
            done?()
        }
    }

    // One finish path for BOTH a manual take and a hands-free VOX clip: optionally read Splice's
    // key/BPM into the filename, then trim/normalize, then refresh the list. Hands-free is exactly
    // when tagging matters most — each auditioned loop becomes its own labelled file.
    func finalize(_ url: URL) {
        let t = doTrim, nz = doNormalize
        let run: ((name: String?, tag: String)?) -> Void = { hit in
            DispatchQueue.global(qos: .userInitiated).async {
                let out = self.renameWithTag(url, hit)
                if t || nz { self.process(out, trim: t, normalize: nz) }
                DispatchQueue.main.async {
                    self.lastURL = out
                    self.hint.stringValue = "Saved \(out.lastPathComponent)"
                    self.reloadFiles()
                }
            }
        }
        if doSpliceTag { spliceKeyBPM { run($0) } } else { run(nil) }
    }

    // MARK: Auto-record (VOX) — all on the audio queue.

    func startClip(pre: [AVAudioPCMBuffer]) {
        let dest = newDest()
        guard let f = try? makeFile(dest) else { return }
        for b in pre { try? f.write(from: b) }  // pre-roll so the attack isn't clipped
        file = f
        clipURL = dest
        writing = true
        silenceFrames = 0
        DispatchQueue.main.async {
            self.lastURL = dest
            self.startedAt = Date()
            self.statusItem.button?.title = "🔴"
        }
    }

    func finishClip() {
        file = nil  // flush/close
        writing = false
        let url = clipURL
        clipURL = nil
        DispatchQueue.main.async {
            self.startedAt = nil
            self.timeLabel.stringValue = "00:00"
            self.statusItem.button?.title = "👂"
        }
        if let url { finalize(url) }
    }

    func copyBuffer(_ src: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let c = AVAudioPCMBuffer(pcmFormat: src.format, frameCapacity: src.frameLength),
              let s = src.floatChannelData, let d = c.floatChannelData else { return nil }
        c.frameLength = src.frameLength
        for ch in 0 ..< Int(src.format.channelCount) {
            memcpy(d[ch], s[ch], Int(src.frameLength) * MemoryLayout<Float>.size)
        }
        return c
    }

    // Post-process a finished WAV in place: trim leading/trailing silence and/or normalize
    // to -1 dBFS peak. Reads the whole file into RAM (fine for clips; a multi-hour take would
    // be ~0.4 GB/hour — stream in chunks only if that ever becomes real).
    func process(_ url: URL, trim: Bool, normalize: Bool) {
        guard trim || normalize else { return }
        guard let read = try? AVAudioFile(forReading: url) else { return }
        let fmt = read.processingFormat
        let total = AVAudioFrameCount(read.length)
        guard total > 0, let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: total),
              (try? read.read(into: buf)) != nil, let ch = buf.floatChannelData else { return }
        let n = Int(buf.frameLength), chs = Int(fmt.channelCount)
        let sr = fmt.sampleRate

        func amp(_ i: Int) -> Float {
            var m: Float = 0
            for c in 0 ..< chs { m = max(m, abs(ch[c][i])) }
            return m
        }

        var first = 0, last = n - 1
        if trim {
            // Coarse pass over 10 ms block maxima — cheap and immune to lone clicks.
            let bs = max(1, Int(sr * 0.010))
            let nb = (n + bs - 1) / bs
            if nb > 2 {
                var block = [Float](repeating: 0, count: nb)
                for w in 0 ..< nb {
                    var m: Float = 0
                    for i in (w * bs) ..< min(n, (w + 1) * bs) { m = max(m, amp(i)) }
                    block[w] = m
                }
                // Noise floor = 5th-percentile block. Threshold sits +6 dB above it but is
                // CLAMPED to [-52, -42] dBFS: it can never climb into audible range, so real
                // audio is never eaten — only genuine near-silence at the ends is cut.
                let floorLvl = block.sorted()[min(nb - 1, max(0, Int(Double(nb) * 0.05)))]
                let thr = min(Float(0.00794), max(Float(0.00251), floorLvl * 2.0))
                func loud(_ w: Int) -> Bool { w >= 0 && w < nb && block[w] > thr }
                var fw = 0
                while fw < nb, !(loud(fw) && loud(fw + 1)) { fw += 1 }  // 2 blocks = real onset
                if fw < nb {
                    var lw = nb - 1
                    while lw > fw, !(loud(lw) && loud(lw - 1)) { lw -= 1 }
                    var f = fw * bs
                    while f < n, amp(f) <= thr { f += 1 }
                    var l = min(n - 1, (lw + 1) * bs - 1)
                    while l > f, amp(l) <= thr { l -= 1 }
                    f = max(0, f - Int(sr * 0.015))   // keep the attack
                    l = min(n - 1, l + Int(sr * 0.040))  // let the tail ring
                    if f < l { first = f; last = l }
                }
            }
        }

        // Normalize the kept region to -1 dBFS peak (both directions), capped at +30 dB so a
        // quiet capture becomes DAW-ready without blowing up a near-silent one.
        var gain: Float = 1
        if normalize {
            var peak: Float = 0
            for i in first ... last { peak = max(peak, amp(i)) }
            if peak > 0.001 { gain = min(32, 0.891 / peak) }
        }

        let trimmed = first > 0 || last < n - 1
        guard trimmed || abs(gain - 1) > 0.001 else { return }  // nothing to do
        let len = AVAudioFrameCount(last - first + 1)
        guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: len),
              let outCh = out.floatChannelData else { return }
        for c in 0 ..< chs {
            let src = ch[c] + first
            if gain == 1 {
                memcpy(outCh[c], src, Int(len) * MemoryLayout<Float>.size)
            } else {
                for i in 0 ..< Int(len) { outCh[c][i] = src[i] * gain }
            }
        }
        out.frameLength = len
        guard let write = try? makeFile(url) else { return }  // overwrite in place
        try? write.write(from: out)
    }

    func tick() {
        guard let startedAt else { return }
        let s = Int(Date().timeIntervalSince(startedAt))
        timeLabel.stringValue = String(format: "%02d:%02d", s / 60, s % 60)
        statusItem.button?.title = String(format: "🔴 %d:%02d", s / 60, s % 60)
    }

    func stream(_: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sb.isValid, var asbd = sb.formatDescription?.audioStreamBasicDescription else { return }
        try? sb.withAudioBufferList { list, _ in
            guard let fmt = AVAudioFormat(streamDescription: &asbd),
                  let buf = AVAudioPCMBuffer(pcmFormat: fmt, bufferListNoCopy: list.unsafePointer),
                  let ch = buf.floatChannelData else { return }
            let frames = Int(buf.frameLength)
            var peak: Float = 0
            for c in 0 ..< Int(buf.format.channelCount) {
                for i in 0 ..< frames { peak = max(peak, abs(ch[c][i])) }
            }
            // sqrt so ordinary listening levels are visible, not a flat line near zero
            wave.push(CGFloat(min(1, sqrt(peak))))

            guard autoMode else { try? file?.write(from: buf); return }  // normal: write everything
            // VOX: open a clip when sound starts, close it after ~1.2 s of silence.
            let onset: Float = 0.015  // ~-36 dBFS
            let hang = Int(buf.format.sampleRate * 1.2)
            if peak > onset {
                if !writing { startClip(pre: preRoll); preRoll.removeAll() }
                silenceFrames = 0
                try? file?.write(from: buf)
            } else if writing {
                try? file?.write(from: buf)  // keep short internal gaps and a bit of tail
                silenceFrames += frames
                if silenceFrames > hang { finishClip() }
            } else if let copy = copyBuffer(buf) {
                // Idle: keep a rolling ~250 ms pre-roll so the next onset's attack survives.
                preRoll.append(copy)
                var held = preRoll.reduce(0) { $0 + Int($1.frameLength) }
                while held > Int(buf.format.sampleRate * 0.25), preRoll.count > 1 {
                    held -= Int(preRoll.removeFirst().frameLength)
                }
            }
        }
    }

    // Without this the UI would keep showing "recording" after the stream died.
    func stream(_: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { self.stop { self.hint.stringValue = "Stopped: \(error.localizedDescription)" } }
    }

    func fail(_ msg: String) {
        FileHandle.standardError.write(("error: " + msg + "\n").data(using: .utf8)!)
        if CommandLine.arguments.contains("--cli") {
            try? msg.write(to: URL(fileURLWithPath: "/tmp/rec-cli.log"), atomically: true, encoding: .utf8)
            exit(1)
        }
        let denied = msg.contains("declined TCC")
        hint.stringValue = denied ? "Permission denied — allow it below, then reopen" : msg
        permissionBox.isHidden = !denied
    }

    // MARK: Splice key/BPM tagging (OCR)

    // Capture Splice's window and read the loaded sample's key + BPM. Async; calls back nil when
    // Splice isn't running or nothing confident is found (a wrong tag is worse than none).
    func spliceKeyBPM(_ done: @escaping ((name: String?, tag: String)?) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            func log(_ s: String) {
                try? s.appending("\n").write(to: URL(fileURLWithPath: "/tmp/rec-splice.log"),
                                             atomically: true, encoding: .utf8)
            }
            // Largest Splice window (it also owns several 1800x39 strips and a tooltip).
            let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
            var winID = 0, bestArea: CGFloat = 0
            for info in list {
                guard let owner = info[kCGWindowOwnerName as String] as? String, owner.contains("Splice"),
                      let n = info[kCGWindowNumber as String] as? Int,
                      let b = info[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
                let w = b["Width"] ?? 0, h = b["Height"] ?? 0
                if w > 400, h > 300, w * h > bestArea { bestArea = w * h; winID = n }
            }
            guard winID != 0 else { log("no Splice window"); return done(nil) }

            // ponytail: shell out to screencapture. Splice usually sits on another Space, where
            // SCScreenshotManager refuses to capture and CGWindowListCreateImage is gone (removed in
            // macOS 26) — `screencapture -l <id>` still grabs a window on any Space.
            let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: "splice-\(winID).png")
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            p.arguments = ["-l", "\(winID)", "-x", "-o", tmp.path]
            try? p.run()
            p.waitUntilExit()
            defer { try? FileManager.default.removeItem(at: tmp) }
            guard let cg = NSImage(contentsOf: tmp)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                log("screencapture failed (win \(winID))"); return done(nil)
            }
            let hit = Recorder.parseSpliceTag(cg)
            log("win \(winID) \(cg.width)x\(cg.height) -> name=\(hit?.name ?? "nil") tag=\(hit?.tag ?? "nil")")
            if hit?.name == nil { Recorder.keepMiss(tmp, tag: hit?.tag) }
            done(hit)
        }
    }

    // Every take that came out unnamed keeps the Splice screenshot that failed, so the next parser fix
    // starts from real failures instead of guessed ones. Replay one with `--splicetag <png>`.
    static let missDir = FileManager.default.homeDirectoryForCurrentUser
        .appending(path: "Library/Application Support/Mac Audio Recorder/misses")

    static func keepMiss(_ png: URL, tag: String?) {
        let fm = FileManager.default
        try? fm.createDirectory(at: missDir, withIntermediateDirectories: true)
        let stamp = DateFormatter()
        stamp.dateFormat = "yyyy-MM-dd HH.mm.ss"
        let dest = missDir.appending(path: "\(stamp.string(from: Date())) — \(tag ?? "no tag").png")
        try? fm.copyItem(at: png, to: dest)
        // ponytail: newest 50 only — full-res captures are ~5 MB each; raise if more history helps.
        let all = ((try? fm.contentsOfDirectory(at: missDir, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "png" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
        all.dropFirst(50).forEach { try? fm.removeItem(at: $0) }
    }

    // Pull "102bpm G#min" out of a Splice screenshot. The bottom transport bar (fixed position,
    // labelled KEY / BPM) is the authority for key-letter + BPM. The min/maj mode is added by
    // matching the bar's (truncated) sample name to its table row and reading that row's KEY column
    // — color-independent, so play/hover/scroll state can't inject a wrong key.
    // Shared OCR pass. usesLanguageCorrection stays off so G#, Am and 102 aren't "corrected".
    static func ocrTokens(_ img: CGImage) -> [(s: String, bb: CGRect)] {
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = false
        guard (try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])) != nil,
              let obs = req.results as? [VNRecognizedTextObservation] else { return [] }
        return obs.compactMap {
            guard let s = $0.topCandidates(1).first?.string else { return nil }
            return (s.trimmingCharacters(in: .whitespaces), $0.boundingBox)
        }
    }

    // Pull "132bpm Cmin" out of a Splice screenshot.
    //
    // Three OCR facts drive this, all learned the hard way:
    //  * Vision DROPS isolated single glyphs, so a one-letter key ("C", "D") — most keys — is simply
    //    absent from a full-page pass. Re-OCR the key box alone, upscaled, and it reads fine.
    //  * The labels come back with Cyrillic look-alikes ("BРМ"), so fold those to Latin.
    //  * "maj" is often read as "mai", so match the mode loosely (mi… / ma…).
    // BPM is the only hard requirement; a missing key must never discard the tempo.
    static func parseSpliceTag(_ cg: CGImage) -> (name: String?, tag: String)? {
        let W = cg.width, H = cg.height
        struct Tok { let s: String; let xf: Double; let xp: Double; let yTop: Int }
        let toks: [Tok] = ocrTokens(cg).map {
            Tok(s: $0.s, xf: $0.bb.midX, xp: $0.bb.midX * Double(W), yTop: Int((1 - $0.bb.midY) * Double(H)))
        }
        func norm(_ s: String) -> String {
            let map: [Character: Character] = ["Р": "P", "М": "M", "К": "K", "Е": "E", "В": "B",
                                               "С": "C", "А": "A", "О": "O", "Н": "H", "Т": "T", "Х": "X", "У": "Y"]
            return String(s.uppercased().map { map[$0] ?? $0 })
        }
        func isKeyLetter(_ s: String) -> Bool { s.range(of: "^[A-G][#b]?$", options: .regularExpression) != nil }
        func bpmOf(_ s: String) -> Int? { Int(s).flatMap { (40...300).contains($0) ? $0 : nil } }
        // "D min" / "F# maj" / "D mai" -> ("D","min") / ("F#","maj")
        func fullKey(_ s: String) -> (letter: String, mode: String)? {
            let re = try! NSRegularExpression(pattern: "^([A-G][#b]?)\\s*(mi[a-z]*|ma[a-z]*)$", options: .caseInsensitive)
            let r = NSRange(s.startIndex..., in: s)
            guard let m = re.firstMatch(in: s, range: r),
                  let lr = Range(m.range(at: 1), in: s), let mr = Range(m.range(at: 2), in: s) else { return nil }
            return (String(s[lr]), s[mr].lowercased().hasPrefix("mi") ? "min" : "maj")
        }

        let band = Int(0.85 * Double(H))
        func label(_ name: String) -> Tok? { toks.first { norm($0.s) == name && $0.yTop > band } }
        func valueAbove(_ lab: Tok, _ ok: (String) -> Bool) -> String? {
            toks.filter { abs($0.xp - lab.xp) < 45 && $0.yTop < lab.yTop && lab.yTop - $0.yTop < 70 && ok($0.s) }
                .min { abs($0.yTop - lab.yTop) < abs($1.yTop - lab.yTop) }?.s
        }
        guard let bpmLab = label("BPM"), let bs = valueAbove(bpmLab, { bpmOf($0) != nil }),
              let b = bpmOf(bs) else { return nil }

        // Bar key letter — with the upscaled-crop retry for single glyphs.
        var barKey: String?
        if let keyLab = label("KEY") {
            barKey = valueAbove(keyLab, isKeyLetter)
            if barKey == nil, let crop = cg.cropping(to: CGRect(x: keyLab.xp - 75, y: Double(keyLab.yTop) - 90,
                                                               width: 150, height: 78)) {
                for scale in [2, 3, 4, 6] {
                    let w = crop.width * scale, h = crop.height * scale
                    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                              space: CGColorSpaceCreateDeviceRGB(),
                                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
                    ctx.interpolationQuality = .high
                    ctx.draw(crop, in: CGRect(x: 0, y: 0, width: w, height: h))
                    guard let up = ctx.makeImage() else { continue }
                    if let hit = ocrTokens(up).map({ $0.s }).first(where: isKeyLetter) { barKey = hit; break }
                }
            }
        }

        // The row's KEY column carries min/maj. Find the row by matching the bar's (truncated) sample
        // name — the transport bar sits below every row, so its name token is the lowest one.
        var rowKey: (letter: String, mode: String)?
        var rowName: String?
        let botTok = toks.filter { $0.yTop > band && $0.s.contains("_") && $0.s.count >= 8 }
            .max { $0.yTop < $1.yTop }
        if var t = botTok?.s, let barY = botTok?.yTop {
            while let l = t.last, !(l.isLetter || l.isNumber || l == "_") { t.removeLast() }

            // Vision mangles the *playing* row's filename — the one row that matters. (Whole-page
            // layout analysis is the culprit: "OS_RRNB_85_songstarter_dawn_Fm.wav" comes back as
            // "OS5sngstarter_dawn_m.wav", yet the same pixels cropped to one line read perfectly.)
            // So don't identify the row by its name at all: the BPM and KEY columns read cleanly,
            // and the transport bar states both — match on those, then re-OCR just that row.
            let nameToks = toks.filter { $0.xf < 0.5 && $0.s.contains("_") && $0.s.count >= 8 && $0.yTop < barY - 10 }
            func rowBPM(_ r: Tok) -> Int? {
                toks.filter { $0.xf > 0.55 && abs($0.yTop - r.yTop) < 24 }.compactMap { bpmOf($0.s) }.first
            }
            func rowKeyOf(_ r: Tok) -> (letter: String, mode: String)? {
                toks.filter { $0.xf > 0.55 && $0.xf < 0.75 && abs($0.yTop - r.yTop) < 24 }
                    .compactMap { fullKey($0.s) }.first
            }
            func reOCRName(_ yMid: Int) -> String? {
                let x = Int(0.19 * Double(W)), w = Int(0.30 * Double(W))
                let y = max(0, yMid - 37), h = min(75, H - y)
                guard w > 0, h > 20, let crop = cg.cropping(to: CGRect(x: x, y: y, width: w, height: h))
                else { return nil }
                return ocrTokens(crop).map(\.s).first { $0.contains("_") && $0.count >= 12 }
            }
            var cands = nameToks.filter { rowBPM($0) == b }
            if let bk = barKey { cands = cands.filter { rowKeyOf($0)?.letter == bk } }
            if cands.count > 1 {
                // Rows sharing tempo AND key are common; the bar's truncated name breaks the tie,
                // but only when one candidate agrees with it further than all the others.
                let lcp: (Tok) -> Int = { zip($0.s, t).prefix(while: { $0 == $1 }).count }
                if let best = cands.max(by: { lcp($0) < lcp($1) }), lcp(best) >= 8,
                   cands.filter({ lcp($0) == lcp(best) }).count == 1 { cands = [best] }
            }
            if cands.count == 1, let row = cands.first {
                rowKey = rowKeyOf(row)
                rowName = reOCRName(row.yTop) ?? (row.s.count >= 12 ? row.s : nil)
            }

            // Fallback: no unique tempo+key row. Splice names share long prefixes, so match on the
            // FULL truncated name; shave a char or two for OCR slop, and only trust a key every
            // matching row agrees on.
            for drop in 0 ... 2 where rowName == nil {
                let pfx = String(t.dropLast(drop))
                guard pfx.count >= 10 else { break }
                let rows = toks.filter { $0.xf < 0.5 && $0.yTop < barY - 10 && $0.s.hasPrefix(pfx) }
                if rows.isEmpty { continue }
                let keys = rows.compactMap { r in
                    toks.filter { fullKey($0.s) != nil && abs($0.yTop - r.yTop) < 24 }
                        .min(by: { abs($0.yTop - r.yTop) < abs($1.yTop - r.yTop) }).flatMap { fullKey($0.s) }
                }
                if let f = keys.first, keys.allSatisfy({ $0 == f }) { rowKey = f }
                // The row text is the untruncated filename — a far better name than a timestamp.
                // Only when the prefix picked out exactly one row, or several spellings of one.
                if let n = rows.first?.s, rows.allSatisfy({ $0.s == n }) { rowName = n }
                break
            }
        }

        // Prefer the row (it has min/maj); if the bar letter also read and they disagree, the row
        // match is suspect so fall back to the bar letter.
        if let rk = rowKey, barKey == nil || rk.letter == barKey! { return (rowName, "\(b)bpm \(rk.letter)\(rk.mode)") }
        if let bk = barKey { return (rowName, "\(b)bpm \(bk)") }
        return (rowName, "\(b)bpm")                         // tempo alone still beats nothing
    }

    // Name the take after the Splice row it came from — "OS_RRNB_132_songstarter_pyramid_alt_Gm —
    // 132bpm Gmin.wav" — so a recorded preview reads like a grabbed file instead of a timestamp.
    // Falls back to the timestamp when OCR found no row; the tag alone is still appended.
    func renameWithTag(_ url: URL, _ hit: (name: String?, tag: String)?) -> URL {
        guard let hit, !hit.tag.isEmpty else { return url }
        let tag = hit.tag
        var base = url.deletingPathExtension().lastPathComponent
        if var n = hit.name {
            if n.lowercased().hasSuffix(".wav") { n = String(n.dropLast(4)) }
            n = n.components(separatedBy: CharacterSet(charactersIn: "/:")).joined(separator: "_")
                 .trimmingCharacters(in: .whitespaces)
            if n.count >= 8 { base = n }
        }
        // Splice filenames already carry the tempo and key ("…_132_…_Gm"), so appending
        // "— 132bpm Gmin" to one is noise. Only tag a name that doesn't state the BPM.
        if base.contains(String(tag.prefix(while: \.isNumber))) { 
            guard base != url.deletingPathExtension().lastPathComponent else { return url }
            let d = url.deletingLastPathComponent().appendingPathComponent(base)
                .appendingPathExtension(url.pathExtension)
            guard !FileManager.default.fileExists(atPath: d.path),
                  (try? FileManager.default.moveItem(at: url, to: d)) != nil else { return url }
            return d
        }
        let dest = url.deletingLastPathComponent()
            .appendingPathComponent("\(base) — \(tag)").appendingPathExtension(url.pathExtension)
        guard !FileManager.default.fileExists(atPath: dest.path),
              (try? FileManager.default.moveItem(at: url, to: dest)) != nil else { return url }
        return dest
    }

    // MARK: Recordings list

    func reloadFiles() {
        let urls = (try? FileManager.default.contentsOfDirectory(at: outputDir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        files = urls.filter { ["wav", "m4a"].contains($0.pathExtension) }.sorted { modified($0) > modified($1) }
        table.reloadData()
    }

    func modified(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
    }

    func numberOfRows(in _: NSTableView) -> Int { files.count }

    func tableView(_: NSTableView, viewFor _: NSTableColumn?, row: Int) -> NSView? {
        let url = files[row]
        let name = NSTextField(labelWithString: url.deletingPathExtension().lastPathComponent)
        name.font = .systemFont(ofSize: 13)
        name.textColor = .white
        let seconds = Int((try? AVAudioFile(forReading: url)).map { Double($0.length) / $0.fileFormat.sampleRate } ?? 0)
        let sub = NSTextField(labelWithString: String(format: "%@%d:%02d", playingRow == row ? "▶ " : "", seconds / 60, seconds % 60))
        sub.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        sub.textColor = playingRow == row ? .systemRed : NSColor(white: 1, alpha: 0.45)
        let cell = NSStackView(views: [name, sub])
        cell.orientation = .vertical
        cell.alignment = .leading
        cell.spacing = 2
        return cell
    }

    func tableView(_: NSTableView, pasteboardWriterForRow row: Int) -> NSPasteboardWriting? {
        files[row] as NSURL
    }

    @objc func renameRow() {
        let row = table.clickedRow
        guard row >= 0, row < files.count else { return }
        let url = files[row]
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        field.stringValue = url.deletingPathExtension().lastPathComponent
        let alert = NSAlert()
        alert.messageText = "Rename recording"
        alert.accessoryView = field
        alert.addButton(withTitle: "Rename")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        // ":" and "/" are illegal in HFS/APFS names — swap for "-".
        let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        guard !name.isEmpty else { return }
        let dest = url.deletingLastPathComponent().appendingPathComponent(name).appendingPathExtension(url.pathExtension)
        guard dest != url, !FileManager.default.fileExists(atPath: dest.path) else { return }
        try? FileManager.default.moveItem(at: url, to: dest)
        if lastURL == url { lastURL = dest }
        if playingRow == row { player?.stop(); playingRow = nil }
        reloadFiles()
    }

    @objc func deleteRow() {
        let row = table.clickedRow
        guard row >= 0, row < files.count else { return }
        if playingRow == row { player?.stop(); playingRow = nil }
        try? FileManager.default.trashItem(at: files[row], resultingItemURL: nil)  // to Trash, recoverable
        reloadFiles()
    }

    @objc func rowClicked() {
        let row = table.clickedRow
        guard row >= 0, row < files.count else { return }
        if playingRow == row {
            player?.stop()
            playingRow = nil
        } else {
            player = try? AVAudioPlayer(contentsOf: files[row])
            player?.play()
            playingRow = row
        }
        table.reloadData()
    }
}

let app = NSApplication.shared
let delegate = Recorder()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
