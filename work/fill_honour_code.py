from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import white, black
from reportlab.pdfgen import canvas


SOURCE = Path("/Users/jagdeepkaur/Downloads/Honour Code_ Online CEP-2.pdf")
OUTPUT = Path(
    "/Users/jagdeepkaur/Documents/Codex/2026-06-04/develop-a-portal-to-manage-physiotherapy/outputs/Honour_Code_Online_CEP-2_filled_Jagdeep_Kaur.pdf"
)

NAME = "Jagdeep Kaur"
DATE = "09/08/2026"
ADDRESS_LINE_1 = "2730b, second floor, sec-57,"
ADDRESS_LINE_2 = "Gurgaon"
MOBILE = "8195976370"


def draw_text(canv: canvas.Canvas, x: float, y: float, text: str, size: int = 11) -> None:
    canv.setFillColor(black)
    canv.setFont("Helvetica", size)
    canv.drawString(x, y, text)


def whiteout(canv: canvas.Canvas, x: float, y: float, width: float, height: float = 15) -> None:
    canv.setFillColor(white)
    canv.setStrokeColor(white)
    canv.rect(x, y, width, height, fill=1, stroke=0)


def make_overlay(page_width: float, page_height: float, page_number: int) -> PdfReader:
    packet = BytesIO()
    canv = canvas.Canvas(packet, pagesize=(page_width, page_height))

    if page_number == 0:
        whiteout(canv, 62, 663, 280)
        draw_text(canv, 66, 666, NAME)
    elif page_number == 1:
        whiteout(canv, 88, 178.5, 128)
        draw_text(canv, 92, 181.5, DATE)

        whiteout(canv, 422, 178.5, 145)
        canv.setFont("Helvetica-Oblique", 11)
        canv.setFillColor(black)
        canv.drawString(426, 181.5, NAME)

        whiteout(canv, 348, 149.5, 210)
        draw_text(canv, 352, 152.5, NAME)

        whiteout(canv, 352, 120.5, 205)
        draw_text(canv, 356, 123.5, MOBILE)

        whiteout(canv, 352, 91.5, 205)
        draw_text(canv, 356, 94.5, ADDRESS_LINE_1)

        whiteout(canv, 312, 62.5, 245)
        draw_text(canv, 316, 65.5, ADDRESS_LINE_2)

    canv.save()
    packet.seek(0)
    return PdfReader(packet)


def main() -> None:
    reader = PdfReader(str(SOURCE))
    writer = PdfWriter()

    for index, page in enumerate(reader.pages):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        overlay = make_overlay(width, height, index)
        page.merge_page(overlay.pages[0])
        writer.add_page(page)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("wb") as fh:
        writer.write(fh)

    print(OUTPUT)


if __name__ == "__main__":
    main()
