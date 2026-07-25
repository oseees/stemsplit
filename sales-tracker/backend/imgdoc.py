"""Render invoices and payment receipts as shareable images (PNG/JPG).

Images preview inline in WhatsApp chats (PDFs show as file attachments), which
is how most customers here actually receive documents. Drawn with Pillow using
the same bundled DejaVu fonts as pdf.py so ₦/₵/₹/€ render correctly.
"""
import io
import os
from PIL import Image, ImageDraw, ImageFont

BRAND = (10, 82, 54)   # #0a5236 — the app's deep-forest green
INK = (17, 24, 39)
MUTED = (107, 114, 128)
LINE = (229, 231, 235)
LIGHT = (243, 244, 246)
GREEN = (22, 163, 74)
GREEN_BG = (220, 252, 231)
AMBER = (180, 83, 9)
AMBER_BG = (254, 243, 199)
RED = (220, 38, 38)
RED_BG = (254, 226, 226)

_FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")


def _font(bold, size):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(os.path.join(_FONT_DIR, name), size)


def _money(cur, v):
    return f"{cur}{v:,.2f}"


def _fit(d, text, font, max_w):
    """Truncate text with an ellipsis so it fits in max_w pixels."""
    if d.textlength(text, font=font) <= max_w:
        return text
    while text and d.textlength(text + "…", font=font) > max_w:
        text = text[:-1]
    return text + "…"


def _right(d, x_right, y, text, font, fill):
    d.text((x_right - d.textlength(text, font=font), y), text, font=font, fill=fill)


def _center(d, cx, y, text, font, fill):
    d.text((cx - d.textlength(text, font=font) / 2, y), text, font=font, fill=fill)


def _badge(d, cx, y, text, font, fg, bg):
    w = d.textlength(text, font=font)
    pad_x, pad_y = 26, 12
    d.rounded_rectangle([cx - w / 2 - pad_x, y, cx + w / 2 + pad_x, y + font.size + pad_y * 2],
                        radius=(font.size + pad_y * 2) / 2, fill=bg)
    d.text((cx - w / 2, y + pad_y), text, font=font, fill=fg)


def _status(paid, balance):
    if balance <= 0.001:
        return "PAID", GREEN, GREEN_BG
    if paid > 0:
        return "PARTIAL", AMBER, AMBER_BG
    return "UNPAID", RED, RED_BG


def _wm(img, text, cy):
    """Faint diagonal business-name watermark behind the content — looks
    professional and makes a doctored screenshot harder to pass off. Drawn
    FIRST so everything else sits on top of it."""
    text = (text or "").strip()
    if not text:
        return
    W = img.width
    d = ImageDraw.Draw(img)
    size = 110
    f = _font(True, size)
    max_w = W * 0.86
    if d.textlength(text, font=f) > max_w:
        size = max(36, int(size * max_w / d.textlength(text, font=f)))
        f = _font(True, size)
    tw = d.textlength(text, font=f)
    layer = Image.new("RGBA", (int(tw) + 20, size * 2), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((10, size // 2), text, font=f, fill=BRAND + (16,))
    layer = layer.rotate(24, expand=True, resample=Image.BICUBIC)
    img.paste(layer, (int((W - layer.width) / 2), int(cy - layer.height / 2)), layer)


def _powered(d, w, y):
    """Marketing footer: every shared invoice/receipt is a tiny ad for the app."""
    fa, fb = _font(False, 20), _font(True, 20)
    segs = [("Made with ", fa, MUTED), ("SalesPal", fb, BRAND),
            (" — track sales & get paid  ·  salespal.online", fa, MUTED)]
    x = (w - sum(d.textlength(t, font=f) for t, f, _ in segs)) / 2
    for t, f, fill in segs:
        d.text((x, y), t, font=f, fill=fill)
        x += d.textlength(t, font=f)


def _export(img, fmt):
    buf = io.BytesIO()
    if fmt == "jpg":
        img.save(buf, "JPEG", quality=92)
    else:
        img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def build_invoice_image(invoice, items, customer, settings, paid=0.0, fmt="png"):
    W, PAD = 1000, 56
    cur = settings.get("currency", "$")
    total = invoice["total"]
    balance = total - paid

    biz_extra = [settings.get(f) for f in ("address", "phone", "email") if settings.get(f)]
    cust_extra = [customer.get(f) for f in ("phone", "email", "address")
                  if customer and customer.get(f)]
    notes = (invoice.get("notes") or "").strip()

    # Bank details block: shown only while a balance is due and transfer is set up.
    pay = settings.get("pay_to")
    bank_lines = []
    if pay and balance > 0.001 and pay.get("number"):
        if pay.get("bank"):
            bank_lines.append(f"Bank: {pay['bank']}")
        bank_lines.append(f"Account number: {pay['number']}")
        if pay.get("name"):
            bank_lines.append(f"Account name: {pay['name']}")

    row_h = 62
    totals_n = 4 if paid > 0 else 2
    H = (150 + max(len(biz_extra), 2) * 30          # header
         + 90 + 40 + len(cust_extra) * 30           # bill-to
         + 70 + len(items) * row_h                  # items table
         + 30 + totals_n * 46                       # totals
         + (70 if notes else 0)
         + (66 + len(bank_lines) * 34 + 24 if bank_lines else 0)  # bank block
         + 220)                                     # status + footers
    # Oversize the canvas; the final crop trims it. (Cropping PAST the canvas
    # would pad with black instead.)
    img = Image.new("RGB", (W, H + 400), "white")
    _wm(img, settings.get("business_name"), H * 0.45)
    d = ImageDraw.Draw(img)

    # Header: business (left) + INVOICE block (right)
    y = PAD
    d.text((PAD, y), settings.get("business_name", "My Business"), font=_font(True, 38), fill=BRAND)
    yy = y + 52
    for line in biz_extra:
        d.text((PAD, yy), str(line), font=_font(False, 22), fill=MUTED)
        yy += 30
    _right(d, W - PAD, y, "INVOICE", _font(True, 42), INK)
    _right(d, W - PAD, y + 56, f"#{invoice['invoice_no']}", _font(False, 26), INK)
    _right(d, W - PAD, y + 92, f"Date: {invoice['date']}", _font(False, 22), MUTED)
    if invoice.get("due_date"):
        _right(d, W - PAD, y + 122, f"Due: {invoice['due_date']}", _font(False, 22), MUTED)
    y = max(yy, y + 150) + 28

    # Bill to
    d.text((PAD, y), "BILL TO", font=_font(False, 20), fill=MUTED)
    y += 32
    d.text((PAD, y), customer["name"] if customer else "Walk-in customer",
           font=_font(True, 26), fill=INK)
    y += 40
    for line in cust_extra:
        d.text((PAD, y), str(line), font=_font(False, 22), fill=MUTED)
        y += 30
    y += 24

    # Items table
    col_qty, col_price, col_amt = W - PAD - 420, W - PAD - 260, W - PAD
    head_f, cell_f = _font(True, 22), _font(False, 24)
    d.rectangle([PAD, y, W - PAD, y + 54], fill=BRAND)
    d.text((PAD + 18, y + 14), "Item", font=head_f, fill="white")
    _right(d, col_qty, y + 14, "Qty", head_f, "white")
    _right(d, col_price, y + 14, "Price", head_f, "white")
    _right(d, col_amt - 18, y + 14, "Amount", head_f, "white")
    y += 54
    for i, it in enumerate(items):
        if i % 2 == 1:
            d.rectangle([PAD, y, W - PAD, y + row_h], fill=LIGHT)
        desc = _fit(d, it["description"], cell_f, col_qty - PAD - 140)
        d.text((PAD + 18, y + 16), desc, font=cell_f, fill=INK)
        _right(d, col_qty, y + 16, f"{it['qty']:g}", cell_f, INK)
        _right(d, col_price, y + 16, _money(cur, it["unit_price"]), cell_f, INK)
        _right(d, col_amt - 18, y + 16, _money(cur, it["qty"] * it["unit_price"]), cell_f, INK)
        d.line([PAD, y + row_h, W - PAD, y + row_h], fill=LINE, width=1)
        y += row_h
    y += 26

    # Totals (right-aligned block). Label sits far enough left that the widest
    # label ("Balance Due") never collides with a large right-aligned amount.
    lbl_x, val_x = W - PAD - 390, W - PAD
    rows = [("Total", _money(cur, total), True, BRAND)]
    if paid > 0:
        rows.append(("Paid", _money(cur, paid), False, INK))
        rows.append(("Balance Due", _money(cur, balance), True, INK))
    for label, val, bold, color in rows:
        f = _font(bold, 26)
        d.text((lbl_x, y), label, font=f, fill=color)
        _right(d, val_x, y, val, f, color)
        y += 46
    y += 12

    # Bank details box (where to pay)
    if bank_lines:
        box_h = 56 + len(bank_lines) * 34 + 16
        d.rounded_rectangle([PAD, y, W - PAD, y + box_h], radius=14, fill=LIGHT)
        d.text((PAD + 22, y + 16), "PAYMENT DETAILS — BANK TRANSFER", font=_font(True, 20), fill=MUTED)
        yy = y + 52
        for ln in bank_lines:
            d.text((PAD + 22, yy), ln, font=_font(False, 24), fill=INK)
            yy += 34
        y += box_h + 24

    if notes:
        d.text((PAD, y), "Notes", font=_font(False, 20), fill=MUTED)
        d.text((PAD, y + 28), _fit(d, notes, _font(False, 22), W - 2 * PAD),
               font=_font(False, 22), fill=MUTED)
        y += 70

    # Status badge + thank-you + powered-by footer
    text, fg, bg = _status(paid, balance)
    _badge(d, W / 2, y + 14, text, _font(True, 24), fg, bg)
    _center(d, W / 2, y + 88, "Thank you for your business!", _font(False, 24), MUTED)
    _powered(d, W, y + 138)
    img = img.crop((0, 0, W, int(y + 196)))
    return _export(img, fmt)


def build_debts_image(debtors, settings, as_of, title="WHO OWES ME", fmt="png"):
    """Debtors statement as an image — the shareable twin of build_debts_pdf.
    debtors = [{name, phone, owed, invoices:[{invoice_no, due_date, total, paid,
    balance, days_late}]}], biggest first. Drops the PDF's invoice-date column:
    on a phone screen, who/how much/how late is what gets read."""
    W, PAD = 1000, 56
    cur = settings.get("currency", "$")
    total_owed = sum(d["owed"] for d in debtors)
    n_inv = sum(len(d["invoices"]) for d in debtors)
    late = sum(1 for d in debtors for i in d["invoices"] if i.get("days_late", 0) > 0)

    pay = settings.get("pay_to")
    bank_lines = []
    if pay and pay.get("number"):
        if pay.get("bank"):
            bank_lines.append(f"Bank: {pay['bank']}")
        bank_lines.append(f"Account number: {pay['number']}")
        if pay.get("name"):
            bank_lines.append(f"Account name: {pay['name']}")

    row_h, grp_h, item_h = 56, 62, 32
    n_items = sum(len(i.get("items", [])) for d in debtors for i in d["invoices"])
    H = (190 + 54 + len(debtors) * grp_h + n_inv * row_h + n_items * item_h + 80
         + (66 + len(bank_lines) * 34 + 24 if bank_lines else 0) + 180)
    img = Image.new("RGB", (W, H + 400), "white")
    _wm(img, settings.get("business_name"), H * 0.45)
    d = ImageDraw.Draw(img)

    # Header: business (left) + title/total (right)
    y = PAD
    biz_f = _font(True, 38)
    biz = _fit(d, settings.get("business_name", "My Business"), biz_f, 430)
    d.text((PAD, y), biz, font=biz_f, fill=BRAND)
    d.text((PAD, y + 52), f"As at {as_of}", font=_font(False, 22), fill=MUTED)
    # shrink the title until it clears the business name — "STATEMENT OF ACCOUNT"
    # is three times the width of the invoice's "INVOICE".
    avail = W - 2 * PAD - d.textlength(biz, font=biz_f) - 30
    size = 34
    while size > 22 and d.textlength(title, font=_font(True, size)) > avail:
        size -= 2
    _right(d, W - PAD, y, title, _font(True, size), INK)
    _right(d, W - PAD, y + 48, _money(cur, total_owed), _font(True, 32), BRAND)
    _right(d, W - PAD, y + 92,
           (f"{len(debtors)} customers · " if len(debtors) > 1 else "")
           + f"{n_inv} unpaid invoice{'s' if n_inv != 1 else ''}"
           + (f" · {late} overdue" if late else ""), _font(False, 22), MUTED)
    y += 150

    # Columns: invoice no (left), due (left), paid + balance (right-aligned). No
    # Total column — at this width it collided with "(54d late)", and paid +
    # balance already say it. The PDF keeps the full grid.
    x_no, x_due = PAD + 18, PAD + 234
    c_paid, c_bal = W - PAD - 230, W - PAD - 18
    head_f, cell_f = _font(True, 22), _font(False, 23)
    d.rectangle([PAD, y, W - PAD, y + 54], fill=BRAND)
    d.text((x_no, y + 14), "Invoice", font=head_f, fill="white")
    d.text((x_due, y + 14), "Due", font=head_f, fill="white")
    _right(d, c_paid, y + 14, "Paid", head_f, "white")
    _right(d, c_bal, y + 14, "Balance", head_f, "white")
    y += 54

    for grp in debtors:
        d.rectangle([PAD, y, W - PAD, y + grp_h], fill=LIGHT)
        name_f, ph_f = _font(True, 26), _font(False, 22)
        who = _fit(d, grp["name"] or "Walk-in customer", name_f, 430)
        d.text((x_no, y + 16), who, font=name_f, fill=INK)
        # phone only if it clears the right-aligned amount
        x_after = x_no + d.textlength(who, font=name_f) + 16
        owed = _money(cur, grp["owed"])
        if grp.get("phone") and x_after + d.textlength(str(grp["phone"]), font=ph_f) < (
                c_bal - d.textlength(owed, font=_font(True, 26)) - 30):
            d.text((x_after, y + 22), str(grp["phone"]), font=ph_f, fill=MUTED)
        _right(d, c_bal, y + 16, owed, _font(True, 26), BRAND)
        y += grp_h
        for inv in grp["invoices"]:
            days = inv.get("days_late", 0)
            due = inv.get("due_date") or "—"
            d.text((x_no, y + 14), _fit(d, str(inv["invoice_no"]), cell_f, x_due - x_no - 20),
                   font=cell_f, fill=INK)
            d.text((x_due, y + 14),
                   _fit(d, f"{due} ({days}d late)" if days else due, cell_f,
                        c_paid - x_due - 150),
                   font=cell_f, fill=RED if days else MUTED)
            _right(d, c_paid, y + 14, _money(cur, inv["paid"]), cell_f, INK)
            _right(d, c_bal, y + 14, _money(cur, inv["balance"]), cell_f, INK)
            y += row_h
            # What was bought (single-customer statement). Indented, muted, with
            # the line amount on the right — so the bill says what it's FOR.
            item_f = _font(False, 20)
            for it in inv.get("items", []):
                d.text((x_no + 20, y + 4),
                       _fit(d, f"{it['qty']:g} × {it['description']}", item_f, c_bal - x_no - 220),
                       font=item_f, fill=MUTED)
                _right(d, c_bal, y + 4, _money(cur, it["qty"] * it["unit_price"]), item_f, MUTED)
                y += item_h
            d.line([PAD, y, W - PAD, y], fill=LINE, width=1)
    y += 26

    lbl_x = W - PAD - 390
    d.text((lbl_x, y), "Total owed", font=_font(True, 28), fill=BRAND)
    _right(d, W - PAD, y, _money(cur, total_owed), _font(True, 28), BRAND)
    y += 60

    if bank_lines:
        box_h = 56 + len(bank_lines) * 34 + 16
        d.rounded_rectangle([PAD, y, W - PAD, y + box_h], radius=14, fill=LIGHT)
        d.text((PAD + 22, y + 16), "PAYMENT DETAILS — BANK TRANSFER",
               font=_font(True, 20), fill=MUTED)
        yy = y + 52
        for ln in bank_lines:
            d.text((PAD + 22, yy), ln, font=_font(False, 24), fill=INK)
            yy += 34
        y += box_h + 24

    _powered(d, W, y + 40)
    return _export(img.crop((0, 0, W, int(y + 100))), fmt)


def build_promo_image(products, settings, fmt="png"):
    """Ready-to-post promo flyer: what's in stock right now, with prices.
    Merchants share it on WhatsApp Status / groups — free advertising for
    them (and the footer quietly advertises us). Low stock becomes a
    scarcity hook ("Only 3 left!")."""
    W, PAD = 1000, 56
    cur = settings.get("currency", "$")
    biz = settings.get("business_name") or "My Business"
    phone = (settings.get("phone") or "").strip()

    # Rows grow to fit a thumbnail when any product has a photo; names indent
    # uniformly so the left edge stays straight.
    have_photos = any(p.get("photo_path") for p in products)
    thumb = 84
    head_h = 230
    row_h = (thumb + 26) if have_photos else 88
    name_x = PAD + thumb + 24 if have_photos else PAD
    cta_h = 110 if phone else 0
    H = head_h + 50 + len(products) * row_h + cta_h + 200
    img = Image.new("RGB", (W, H + 300), "white")
    _wm(img, biz, head_h + (len(products) * row_h) / 2 + 40)
    d = ImageDraw.Draw(img)

    # Header band
    d.rectangle([0, 0, W, head_h], fill=BRAND)
    d.text((PAD, 46), _fit(d, biz, _font(True, 52), W - 2 * PAD), font=_font(True, 52), fill="white")
    d.text((PAD, 118), "NOW IN STOCK — TODAY'S PRICES", font=_font(True, 26), fill=(127, 200, 166))
    import datetime as _dt
    d.text((PAD, 158), _dt.date.today().strftime("%d %B %Y"), font=_font(False, 24), fill=(200, 226, 213))

    y = head_h + 40
    name_f, price_f, note_f = _font(True, 30), _font(True, 30), _font(True, 20)
    for i, p in enumerate(products):
        ty = y + (14 if have_photos else 0)   # text baseline sits mid-thumb
        if p.get("photo_path"):
            try:
                ph = Image.open(p["photo_path"]).convert("RGB")
                # center-crop square, then rounded corners via an alpha mask
                s = min(ph.size)
                ph = ph.crop(((ph.width - s) // 2, (ph.height - s) // 2,
                              (ph.width + s) // 2, (ph.height + s) // 2))
                ph = ph.resize((thumb, thumb))
                mask = Image.new("L", (thumb, thumb), 0)
                ImageDraw.Draw(mask).rounded_rectangle([0, 0, thumb, thumb], radius=14, fill=255)
                img.paste(ph, (PAD, y), mask)
            except Exception:
                pass   # unreadable file → row just renders without a thumb
        price = _money(cur, p["unit_price"])
        price_w = d.textlength(price, font=price_f)
        d.text((name_x, ty), _fit(d, p["name"], name_f, W - name_x - PAD - price_w - 40),
               font=name_f, fill=INK)
        _right(d, W - PAD, ty, price, price_f, BRAND)
        low = p.get("low_stock_at") or 0
        if low and p["stock_qty"] <= low:
            d.text((name_x, ty + 40), f"Only {p['stock_qty']:g} left — hurry!", font=note_f, fill=AMBER)
        d.line([PAD, y + row_h - 20, W - PAD, y + row_h - 20], fill=LINE, width=1)
        y += row_h

    if phone:
        y += 14
        d.rounded_rectangle([PAD, y, W - PAD, y + 92], radius=16, fill=GREEN_BG)
        _center(d, W / 2, y + 30, f"Call or WhatsApp to order: {phone}", _font(True, 26), GREEN)
        y += 92 + 20
    else:
        y += 14

    _powered(d, W, y + 24)
    img = img.crop((0, 0, W, int(y + 84)))
    return _export(img, fmt)


def build_receipt_image(invoice, payment, customer, settings, paid, balance, fmt="png"):
    """Receipt for one payment: what was received, from whom, and what remains."""
    W, PAD = 1000, 56
    cur = settings.get("currency", "$")
    fully_paid = balance <= 0.001
    H = 1300  # oversized; cropped to content at the end
    img = Image.new("RGB", (W, H), "white")
    # Center the mark in the open amount zone — the summary card lower down is
    # an opaque fill drawn after it, so anything under the card is hidden.
    _wm(img, settings.get("business_name"), 330)
    d = ImageDraw.Draw(img)

    # Top accent bar + business name
    d.rectangle([0, 0, W, 14], fill=BRAND)
    y = PAD + 10
    _center(d, W / 2, y, settings.get("business_name", "My Business"), _font(True, 38), BRAND)
    y += 58
    _center(d, W / 2, y, "PAYMENT RECEIPT", _font(False, 24), MUTED)
    y += 56

    # Green check circle
    r = 46
    cx = W / 2
    d.ellipse([cx - r, y, cx + r, y + 2 * r], fill=GREEN_BG)
    d.line([cx - 20, y + r + 2, cx - 6, y + r + 18], fill=GREEN, width=9)
    d.line([cx - 6, y + r + 18, cx + 24, y + r - 16], fill=GREEN, width=9)
    y += 2 * r + 30

    # Amount received
    _center(d, W / 2, y, _money(cur, payment["amount"]), _font(True, 64), INK)
    y += 86
    who = customer["name"] if customer else "Walk-in customer"
    _center(d, W / 2, y, f"received from {who}", _font(False, 26), MUTED)
    y += 44
    meta = f"{payment.get('date') or invoice['date']}"
    if payment.get("method"):
        meta += f"  ·  {payment['method']}"
    _center(d, W / 2, y, meta, _font(False, 22), MUTED)
    y += 56

    # Summary card
    card_top = y
    rows = [
        ("Invoice", f"#{invoice['invoice_no']}"),
        ("Invoice total", _money(cur, invoice["total"])),
        ("Total paid", _money(cur, paid)),
        ("Balance", _money(cur, balance)),
    ]
    card_h = len(rows) * 56 + 24
    d.rounded_rectangle([PAD, card_top, W - PAD, card_top + card_h], radius=18, fill=LIGHT)
    yy = card_top + 20
    for label, val in rows:
        d.text((PAD + 30, yy), label, font=_font(False, 24), fill=MUTED)
        _right(d, W - PAD - 30, yy, val, _font(True, 24), INK)
        yy += 56
    y = card_top + card_h + 40

    if fully_paid:
        _badge(d, W / 2, y, "PAID IN FULL", _font(True, 24), GREEN, GREEN_BG)
        y += 92
        _center(d, W / 2, y, "Thank you for your business!", _font(True, 28), INK)
        y += 44
        _center(d, W / 2, y, "We appreciate you — see you again soon.", _font(False, 22), MUTED)
    else:
        _badge(d, W / 2, y, f"BALANCE DUE: {_money(cur, balance)}", _font(True, 24), AMBER, AMBER_BG)
        y += 92
        _center(d, W / 2, y, "Thank you for your part-payment!", _font(True, 28), INK)
        y += 44
        due = invoice.get("due_date")
        urge = f"Kindly pay the balance of {_money(cur, balance)}"
        urge += f" by {due} " if due else " "
        urge += "to complete this order."
        _center(d, W / 2, y, urge, _font(False, 22), AMBER)
    _powered(d, W, y + 56)
    img = img.crop((0, 0, W, int(y + 114)))
    return _export(img, fmt)
