"""Generate PDF from the appendix markdown file."""
import markdown
from weasyprint import HTML

MD_FILE = "/home/user/superbuzz-sdk/docs/appendix-filter-system.md"
OUT_FILE = "/home/user/superbuzz-sdk/docs/appendix-filter-system.pdf"

with open(MD_FILE, "r") as f:
    md_content = f.read()

html_body = markdown.markdown(md_content, extensions=["tables", "fenced_code"])

full_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {{
    size: A4;
    margin: 2.5cm 2cm;
    @bottom-center {{
      content: counter(page);
      font-size: 9pt;
      color: #888;
    }}
  }}
  body {{
    font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1a1a1a;
    max-width: 100%;
  }}
  h1 {{
    font-size: 22pt;
    color: #1E3A5F;
    border-bottom: 3px solid #1E3A5F;
    padding-bottom: 8px;
    margin-top: 0;
  }}
  h2 {{
    font-size: 16pt;
    color: #1E3A5F;
    border-bottom: 1px solid #ddd;
    padding-bottom: 4px;
    margin-top: 28px;
    page-break-after: avoid;
  }}
  h3 {{
    font-size: 13pt;
    color: #2d5a8e;
    margin-top: 20px;
    page-break-after: avoid;
  }}
  p {{
    margin: 8px 0;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 10pt;
    page-break-inside: avoid;
  }}
  th {{
    background-color: #1E3A5F;
    color: white;
    text-align: left;
    padding: 8px 10px;
    font-weight: 600;
  }}
  td {{
    padding: 7px 10px;
    border-bottom: 1px solid #e0e0e0;
    vertical-align: top;
  }}
  tr:nth-child(even) td {{
    background-color: #f8f9fa;
  }}
  code {{
    background-color: #f0f2f5;
    padding: 2px 5px;
    border-radius: 3px;
    font-family: 'SF Mono', Consolas, 'Liberation Mono', monospace;
    font-size: 9.5pt;
    color: #c7254e;
  }}
  pre {{
    background-color: #f0f2f5;
    padding: 14px 16px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 9pt;
    line-height: 1.5;
    border: 1px solid #e0e0e0;
    page-break-inside: avoid;
  }}
  pre code {{
    background: none;
    padding: 0;
    color: #333;
  }}
  blockquote {{
    border-left: 4px solid #1E3A5F;
    margin: 12px 0;
    padding: 8px 16px;
    background-color: #f0f5fa;
    color: #333;
    font-style: italic;
  }}
  strong {{
    color: #1a1a1a;
  }}
  hr {{
    border: none;
    border-top: 2px solid #e0e0e0;
    margin: 24px 0;
  }}
  em {{
    color: #555;
  }}
  ul, ol {{
    margin: 8px 0;
    padding-left: 24px;
  }}
  li {{
    margin: 4px 0;
  }}
  .cover {{
    text-align: center;
    padding-top: 120px;
    page-break-after: always;
  }}
  .cover h1 {{
    font-size: 28pt;
    border: none;
    color: #1E3A5F;
  }}
  .cover .subtitle {{
    font-size: 14pt;
    color: #555;
    margin-top: 12px;
  }}
  .cover .meta {{
    font-size: 11pt;
    color: #888;
    margin-top: 40px;
  }}
</style>
</head>
<body>

<div class="cover">
  <h1>SuperBuzz PPC Analytics</h1>
  <div class="subtitle">Appendix: Global Filter System</div>
  <div class="subtitle">Platform Filtering &amp; Customer Segmentation</div>
  <div class="meta">
    <p>Handover Documentation</p>
    <p>May 2026</p>
  </div>
</div>

{html_body}

</body>
</html>"""

HTML(string=full_html).write_pdf(OUT_FILE)
print(f"PDF generated: {OUT_FILE}")
