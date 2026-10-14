"""Generate original, synthetic PDF fixtures. Requires reportlab and pypdf."""
from pathlib import Path
import sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from pypdf import PdfReader, PdfWriter

dest = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures'
dest.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('HeiseiMin-W3'))

def generate_forms_fixture():
    form_sample = dest / 'forms-sample.pdf'
    form_canvas = canvas.Canvas(str(form_sample), pagesize=(595.28, 841.89))
    form_canvas.setTitle('PDFReader - Forms sample')
    form_canvas.setFont('Helvetica-Bold', 18)
    form_canvas.drawString(48, 770, 'AcroForm test fixture')
    form_canvas.setFont('Helvetica', 12)
    form_canvas.drawString(48, 720, 'Name')
    form_canvas.acroForm.textfield(
        name='applicant',
        tooltip='Name',
        x=100,
        y=700,
        width=260,
        height=26,
        fontName='Helvetica',
        fontSize=12,
    )
    form_canvas.drawString(48, 660, 'Approved')
    form_canvas.acroForm.checkbox(
        name='approved',
        tooltip='Approved',
        x=100,
        y=650,
        size=18,
        buttonStyle='check',
        checked=False,
    )
    form_canvas.save()

if '--forms-only' in sys.argv:
    generate_forms_fixture()
    print('Generated AcroForm fixture in', dest)
    raise SystemExit(0)

sample = dest / 'reading-sample.pdf'
c = canvas.Canvas(str(sample), pagesize=(595.28, 841.89))
c.setTitle('PDFReader - Reading sample')
c.setAuthor('PDFReader contributors')
for i, title in enumerate(['A quieter way to read.', 'Find what matters.', 'Your files stay yours.'], 1):
    c.bookmarkPage(f'page{i}')
    c.addOutlineEntry(title, f'page{i}', 0)
    c.setFillColorRGB(.16, .37, .30)
    c.rect(0, 789, 595.28, 53, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont('Helvetica', 11)
    c.drawString(48, 810, 'PDFReader  /  READING SAMPLE')
    c.setFillColorRGB(.15, .23, .20)
    c.setFont('Helvetica-Bold', 29)
    c.drawString(48, 711, title)
    c.setFont('HeiseiMin-W3', 18)
    c.drawString(48, 662, '日本語の検索と表示を確認します。')
    c.setFont('Helvetica', 12)
    for n, line in enumerate([
        'This document is a local PDFReader test fixture.',
        'Search for "local" to find a match on every page.',
        'Select text, switch tabs, zoom, rotate, and explore the outline.',
        'No account. No uploads. Just your documents.',
    ]):
        c.drawString(48, 610 - n * 24, line)
    for n, height in enumerate([68, 120, 94, 161, 187]):
        c.setFillColorRGB(.72 - n * .08, .80 - n * .065, .66 - n * .07)
        c.roundRect(55 + 96 * n, 225, 65, height, 4, fill=1, stroke=0)
    c.setFillColorRGB(.48, .57, .44)
    c.setFont('Helvetica', 10)
    c.drawString(48, 55, 'Synthetic sample / Apache-2.0')
    c.drawRightString(548, 55, str(i))
    if i == 1:
        c.linkURL('https://example.com/', (48, 530, 500, 550), relative=0)
    c.showPage()
c.save()
writer = PdfWriter(clone_from=str(sample))
writer.encrypt('reader-test', algorithm='AES-256')
with (dest / 'password-sample.pdf').open('wb') as f:
    writer.write(f)
writer = PdfWriter()
source = PdfReader(sample)
for i in range(120):
    writer.add_page(source.pages[i % 3])
with (dest / 'long-sample.pdf').open('wb') as f:
    writer.write(f)
(dest / 'broken.pdf').write_bytes(b'%PDF-1.7\nNot a valid document.\n%%EOF')
(dest / 'not-a-pdf.txt').write_text('Not a PDF.', encoding='utf-8')
generate_forms_fixture()
print('Generated six synthetic fixtures in', dest)
