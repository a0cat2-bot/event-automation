#!/usr/bin/env python3
"""Fill the fixed EHS letter layout (assets/letter_template.html) with content
and produce a standalone HTML file. No third-party dependencies required.

Usage:
    python3 build_letter.py --config letter_config.json --out output.html

Config JSON shape (see SKILL.md for the full field guide per category):
{
  "category_label": "미당첨 안내",              // shown small, above the title
  "program_name": "2026 여름 안전교육 프로그램",  // shown large, top-center
  "org_name": "AX센터",                          // shown bottom, always
  "character_image": "path/to/character.png",   // optional, omit/null if none
  "brand_color": "#0052CC",                      // optional, defaults to #0052CC
  "datetime_location": "2026-08-10 14:00 · 대강당",  // optional
  "body": "본문 텍스트...",
  "gift_info": "기프티콘 1만원 지급",             // optional
  "precautions": ["문구1", "문구2"],              // optional list
  "cta": {"text": "설문 참여하기", "url": "https://..."}  // optional
}
"""
import argparse
import base64
import html
import json
import mimetypes
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
TEMPLATE_PATH = SCRIPT_DIR.parent / "assets" / "letter_template.html"
DEFAULT_BRAND_COLOR = "#0052CC"


def escape(text: str) -> str:
    return html.escape(text, quote=False)


def build_character_block(image_path: str | None) -> str:
    if not image_path:
        return ""
    path = Path(image_path)
    if not path.is_file():
        raise FileNotFoundError(f"character_image not found: {image_path}")
    mime, _ = mimetypes.guess_type(path.name)
    mime = mime or "image/png"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    data_url = f"data:{mime};base64,{data}"
    return f'<div class="letter-character"><img src="{data_url}" alt="캐릭터"></div>'


def build_datetime_block(value: str | None) -> str:
    if not value:
        return ""
    return f'<div class="letter-datetime">{escape(value)}</div>'


def build_gift_block(value: str | None) -> str:
    if not value:
        return ""
    return f'<div class="letter-gift"><strong>제공 사항</strong>{escape(value)}</div>'


def build_precautions_block(items: list[str] | None) -> str:
    if not items:
        return ""
    lis = "".join(f"<li>{escape(item)}</li>" for item in items)
    return f'<div class="letter-precautions"><strong>안내 및 유의사항</strong><ul>{lis}</ul></div>'


def build_cta_block(cta: dict | None) -> str:
    if not cta or not cta.get("text") or not cta.get("url"):
        return ""
    return (
        f'<div class="letter-cta"><a href="{escape(cta["url"])}">'
        f'{escape(cta["text"])}</a></div>'
    )


def build_letter_html(config: dict) -> str:
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    brand_color = config.get("brand_color") or DEFAULT_BRAND_COLOR

    replacements = {
        "__BRAND_COLOR__": brand_color,
        "__CHARACTER_BLOCK__": build_character_block(config.get("character_image")),
        "__CATEGORY_LABEL__": escape(config.get("category_label", "")),
        "__PROGRAM_NAME__": escape(config.get("program_name", "")),
        "__DATETIME_BLOCK__": build_datetime_block(config.get("datetime_location")),
        "__BODY_TEXT__": escape(config.get("body", "")),
        "__GIFT_BLOCK__": build_gift_block(config.get("gift_info")),
        "__PRECAUTIONS_BLOCK__": build_precautions_block(config.get("precautions")),
        "__CTA_BLOCK__": build_cta_block(config.get("cta")),
        "__ORG_NAME__": escape(config.get("org_name", "")),
    }
    for token, value in replacements.items():
        template = template.replace(token, value)
    return template


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Path to the letter config JSON file")
    parser.add_argument("--out", required=True, help="Path to write the generated HTML file")
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    output_html = build_letter_html(config)
    Path(args.out).write_text(output_html, encoding="utf-8")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
