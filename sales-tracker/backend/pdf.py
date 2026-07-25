"""Generate a clean PDF invoice using reportlab.

Uses an embedded DejaVuSans font so non-Latin currency symbols (₦ Naira, ₵, ₹,
€, etc.) render correctly — reportlab's built-in Helvetica can't draw them.
"""
import io
import os
from xml.sax.saxutils import escape as xml_escape
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ACCENT = colors.HexColor("#0a5236")  # SalesPal deep-forest green (matches the app)
MUTED = colors.HexColor("#6b7280")
LIGHT = colors.HexColor("#f3f4f6")

# Register the bundled Unicode font once. Fall back to Helvetica if the font
# files are missing for any reason (amounts in non-Latin currencies may not show).
FONT, FONT_BOLD = "Helvetica", "Helvetica-Bold"
_FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
try:
    pdfmetrics.registerFont(TTFont("DejaVuSans", os.path.join(_FONT_DIR, "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", os.path.join(_FONT_DIR, "DejaVuSans-Bold.ttf")))
    pdfmetrics.registerFontFamily("DejaVuSans", normal="DejaVuSans", bold="DejaVuSans-Bold")
    FONT, FONT_BOLD = "DejaVuSans", "DejaVuSans-Bold"
except Exception:
    pass


def _money(cur, v):
    return f"{cur}{v:,.2f}"


def _wm_page(canv, doc, text):
    """Faint diagonal business-name watermark behind the page content."""
    text = (text or "").strip()
    if not text:
        return
    canv.saveState()
    size = 60
    w = pdfmetrics.stringWidth(text, FONT_BOLD, size)
    if w > 460:  # fit the diagonal band across A4
        size = max(24, size * 460 / w)
    canv.setFont(FONT_BOLD, size)
    canv.setFillColor(ACCENT)
    canv.setFillAlpha(0.05)
    pw, ph = A4
    canv.translate(pw / 2, ph / 2)
    canv.rotate(30)
    canv.drawCentredString(0, 0, text)
    canv.restoreState()


def build_debts_pdf(debtors: list, settings: dict, as_of: str,
                    title: str = "WHO OWES ME") -> bytes:
    """Debtors statement: every customer who owes, broken down invoice by invoice.

    debtors = [{name, phone, owed, invoices: [{invoice_no, date, due_date,
                total, paid, balance, days_late}]}], biggest debtor first.
    settings["pay_to"] adds a bank-transfer box (single-customer statements, which
    get sent to the customer).
    """
    cur = settings.get("currency", "$")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=styles["Normal"], fontName=FONT, fontSize=9,
                           textColor=MUTED, leading=12)
    normal = ParagraphStyle("n", parent=styles["Normal"], fontName=FONT, fontSize=10, leading=13)

    total_owed = sum(d["owed"] for d in debtors)
    n_inv = sum(len(d["invoices"]) for d in debtors)
    late = sum(1 for d in debtors for i in d["invoices"] if i.get("days_late", 0) > 0)

    head = [[
        [Paragraph(settings.get("business_name", "My Business"),
                   ParagraphStyle("biz", parent=styles["Title"], fontName=FONT_BOLD, fontSize=20,
                                  textColor=ACCENT, spaceAfter=2, alignment=0)),
         Paragraph(f"As at {as_of}", small)],
        [Paragraph(title, ParagraphStyle("t", parent=styles["Title"], fontName=FONT_BOLD,
                                        fontSize=18, textColor=colors.HexColor("#111827"),
                                        alignment=2)),
         Paragraph(_money(cur, total_owed), ParagraphStyle("tot", parent=normal, alignment=2,
                                                           fontName=FONT_BOLD, fontSize=14,
                                                           textColor=ACCENT)),
         Paragraph((f"{len(debtors)} customers · " if len(debtors) > 1 else "")
                   + f"{n_inv} unpaid invoice{'s' if n_inv != 1 else ''}"
                   + (f" · {late} overdue" if late else ""),
                   ParagraphStyle("c", parent=small, alignment=2))],
    ]]
    header = Table(head, colWidths=[87 * mm, 87 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))

    data = [["Invoice", "Date", "Due", "Total", "Paid", "Balance"]]
    st = [
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTNAME", (0, 1), (-1, -1), FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("ALIGN", (3, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor("#e5e7eb")),
    ]
    for d in debtors:
        # escaped: reportlab Paragraphs are mini-XML, and a customer named "A & B"
        # would otherwise blow up the whole statement.
        who = xml_escape(d["name"] or "Walk-in customer")
        if d.get("phone"):
            who += f'  <font color="#6b7280">{xml_escape(d["phone"])}</font>'
        r = len(data)
        data.append([Paragraph(f"<b>{who}</b>", ParagraphStyle(
            "who", parent=normal, fontName=FONT_BOLD, fontSize=10)), "", "", "", "",
            Paragraph(f"<b>{_money(cur, d['owed'])}</b>", ParagraphStyle(
                "w2", parent=normal, fontName=FONT_BOLD, fontSize=10, alignment=2,
                textColor=ACCENT))])
        st += [("SPAN", (0, r), (4, r)), ("BACKGROUND", (0, r), (-1, r), LIGHT),
               ("LINEABOVE", (0, r), (-1, r), 0.6, ACCENT)]
        for inv in d["invoices"]:
            due = inv.get("due_date") or "—"
            days = inv.get("days_late", 0)
            if days > 0:
                due += f" ({days}d late)"
            row = len(data)
            data.append([inv["invoice_no"], inv["date"], due, _money(cur, inv["total"]),
                         _money(cur, inv["paid"]), _money(cur, inv["balance"])])
            if days > 0:
                st.append(("TEXTCOLOR", (2, row), (2, row), colors.HexColor("#b91c1c")))

    table = Table(data, colWidths=[30 * mm, 22 * mm, 34 * mm, 29 * mm, 29 * mm, 30 * mm],
                  repeatRows=1)
    table.setStyle(TableStyle(st))

    grand = Table([["Total owed", _money(cur, total_owed)]], colWidths=[44 * mm, 30 * mm],
                  hAlign="RIGHT")
    grand.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"), ("FONTNAME", (0, 0), (-1, -1), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 11), ("TEXTCOLOR", (0, 0), (-1, -1), ACCENT),
        ("LINEABOVE", (0, 0), (-1, -1), 0.6, MUTED),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))

    elems = [header, Spacer(1, 10 * mm), table, Spacer(1, 5 * mm), grand, Spacer(1, 10 * mm)]

    # Where to pay — same box as the invoice, so a statement sent to a customer
    # is actionable on its own.
    pay = settings.get("pay_to")
    if pay and pay.get("number"):
        lines = [Paragraph("PAYMENT DETAILS — bank transfer",
                           ParagraphStyle("l", parent=small, fontSize=8))]
        if pay.get("bank"):
            lines.append(Paragraph(f"Bank: {xml_escape(pay['bank'])}", normal))
        lines.append(Paragraph(f"Account number: {xml_escape(pay['number'])}", normal))
        if pay.get("name"):
            lines.append(Paragraph(f"Account name: {xml_escape(pay['name'])}", normal))
        box = Table([[lines]], colWidths=[110 * mm], hAlign="LEFT")
        box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
            ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        elems += [box, Spacer(1, 10 * mm)]

    elems += [
             Paragraph('Made with <font color="#0a5236"><b>SalesPal</b></font> — track sales &amp; '
                       'get paid &nbsp;·&nbsp; <link href="https://salespal.online" '
                       'color="#0a5236">salespal.online</link>',
                       ParagraphStyle("powered", parent=small, alignment=1, fontSize=8))]
    wm = lambda c, dd: _wm_page(c, dd, settings.get("business_name"))
    doc.build(elems, onFirstPage=wm, onLaterPages=wm)
    return buf.getvalue()


def build_invoice_pdf(invoice: dict, items: list, customer: dict, settings: dict,
                      paid: float = 0.0) -> bytes:
    cur = settings.get("currency", "$")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
    )
    styles = getSampleStyleSheet()
    h_biz = ParagraphStyle("biz", parent=styles["Title"], fontName=FONT_BOLD, fontSize=20,
                           textColor=ACCENT, spaceAfter=2, alignment=0)
    small = ParagraphStyle("small", parent=styles["Normal"], fontName=FONT, fontSize=9,
                           textColor=MUTED, leading=12)
    label = ParagraphStyle("label", parent=styles["Normal"], fontName=FONT, fontSize=8,
                           textColor=MUTED, leading=11)
    normal = ParagraphStyle("n", parent=styles["Normal"], fontName=FONT, fontSize=10, leading=13)
    right = ParagraphStyle("r", parent=normal, alignment=2)

    elems = []

    # Header: business info (left) + INVOICE block (right)
    biz_lines = [Paragraph(settings.get("business_name", "My Business"), h_biz)]
    for field in ("address", "phone", "email"):
        val = settings.get(field)
        if val:
            biz_lines.append(Paragraph(val, small))

    inv_block = [
        Paragraph("INVOICE", ParagraphStyle("inv", parent=styles["Title"], fontName=FONT_BOLD,
                  fontSize=22, textColor=colors.HexColor("#111827"), alignment=2)),
        Paragraph(f"#{invoice['invoice_no']}", right),
        Paragraph(f"Date: {invoice['date']}", ParagraphStyle("d", parent=small, alignment=2)),
    ]
    if invoice.get("due_date"):
        inv_block.append(Paragraph(f"Due: {invoice['due_date']}",
                                   ParagraphStyle("d2", parent=small, alignment=2)))

    header = Table([[biz_lines, inv_block]], colWidths=[95 * mm, 79 * mm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elems += [header, Spacer(1, 12 * mm)]

    # Bill To
    cust_name = customer["name"] if customer else "Walk-in customer"
    bill = [Paragraph("BILL TO", label), Paragraph(cust_name, normal)]
    if customer:
        for field in ("phone", "email", "address"):
            if customer.get(field):
                bill.append(Paragraph(customer[field], small))
    elems += bill + [Spacer(1, 8 * mm)]

    # Items table
    data = [["Item", "Qty", "Price", "Amount"]]
    for it in items:
        amt = it["qty"] * it["unit_price"]
        data.append([
            Paragraph(it["description"], normal),
            f"{it['qty']:g}",
            _money(cur, it["unit_price"]),
            _money(cur, amt),
        ])
    table = Table(data, colWidths=[90 * mm, 20 * mm, 32 * mm, 32 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTNAME", (0, 1), (-1, -1), FONT),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
    ]))
    elems += [table, Spacer(1, 6 * mm)]

    total = invoice["total"]
    balance = total - paid
    totals_rows = [["Subtotal", _money(cur, total)], ["Total", _money(cur, total)]]
    if paid > 0:
        totals_rows.append(["Paid", _money(cur, paid)])
        totals_rows.append(["Balance Due", _money(cur, balance)])
    totals = Table(totals_rows, colWidths=[42 * mm, 32 * mm], hAlign="RIGHT")
    style = [
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("FONTNAME", (0, 0), (-1, -1), FONT),
        ("FONTNAME", (0, 1), (-1, 1), FONT_BOLD),
        ("TEXTCOLOR", (0, 1), (-1, 1), ACCENT),
    ]
    if paid > 0:
        style.append(("FONTNAME", (0, -1), (-1, -1), FONT_BOLD))
        style.append(("LINEABOVE", (0, -1), (-1, -1), 0.5, MUTED))
    totals.setStyle(TableStyle(style))
    elems += [totals, Spacer(1, 12 * mm)]

    # Bank details so the customer knows where to pay (only while a balance is
    # outstanding and the merchant has set up bank transfer).
    pay = settings.get("pay_to")
    if pay and balance > 0.001 and pay.get("number"):
        pay_lines = [Paragraph("PAYMENT DETAILS — bank transfer", label)]
        if pay.get("bank"):
            pay_lines.append(Paragraph(f"Bank: {pay['bank']}", normal))
        pay_lines.append(Paragraph(f"Account number: {pay['number']}", normal))
        if pay.get("name"):
            pay_lines.append(Paragraph(f"Account name: {pay['name']}", normal))
        box = Table([[pay_lines]], colWidths=[110 * mm], hAlign="LEFT")
        box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ]))
        elems += [box, Spacer(1, 10 * mm)]

    if invoice.get("notes"):
        elems += [Paragraph("Notes", label), Paragraph(invoice["notes"], small),
                  Spacer(1, 6 * mm)]

    status = "PAID" if balance <= 0.001 else ("PARTIAL" if paid > 0 else "UNPAID")
    elems.append(Paragraph(
        f"Status: {status} &nbsp;&nbsp;•&nbsp;&nbsp; Thank you for your business!",
        ParagraphStyle("foot", parent=small, alignment=1)))
    # Marketing footer: every shared invoice is a tiny ad for the app.
    elems += [Spacer(1, 3 * mm), Paragraph(
        'Made with <font color="#0a5236"><b>SalesPal</b></font> — track sales &amp; get paid '
        '&nbsp;·&nbsp; <link href="https://salespal.online" color="#0a5236">salespal.online</link>',
        ParagraphStyle("powered", parent=small, alignment=1, fontSize=8))]

    wm = lambda c, d: _wm_page(c, d, settings.get("business_name"))
    doc.build(elems, onFirstPage=wm, onLaterPages=wm)
    return buf.getvalue()
