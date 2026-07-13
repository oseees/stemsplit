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


def build_receipt_image(invoice, payment, customer, settings, paid, balance, fmt="png"):
    """Receipt for one payment: what was received, from whom, and what remains."""
    W, PAD = 1000, 56
    cur = settings.get("currency", "$")
    fully_paid = balance <= 0.001
    H = 1300  # oversized; cropped to content at the end
    img = Image.new("RGB", (W, H), "white")
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
