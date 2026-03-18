"""
AutoApply — Resume Template v2 (Jake's Resume Style)
------------------------------------------------------
Ultra clean · Black & white · Tight spacing · ATS-safe

Layout rules (Jake's style):
  - Name: centered, large bold
  - Contact: centered, pipe-separated, small
  - Section headers: ALL CAPS bold, full-width rule underneath, flush left
  - Job header: Company bold-left | Dates right  (same line)
               Title italic-left | Location right (line below)
  - Bullets: tight, standard •, 9.5pt
  - Margins: 36pt left/right (tighter than standard = more content)
  - Zero decorative elements — pure typography
"""

import json
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor, black, white
from reportlab.pdfgen import canvas

W, H   = 612, 792
L      = 36          # left margin
R      = 576         # right margin  (W - L)
CW     = R - L       # content width = 540
MID    = W / 2

BLACK  = HexColor("#000000")
DGRAY  = HexColor("#222222")
MGRAY  = HexColor("#555555")

COORD  = {}          # filled as we go — exported to JSON

# ── helpers ───────────────────────────────────────────────────────────────────

def rl(pdl_y):
    """pdf-lib Y (bottom-origin) → reportlab Y (top-origin, no size adjust)."""
    return pdl_y

def font(c, weight="regular", size=10):
    f = {"regular": "Helvetica",
         "bold":    "Helvetica-Bold",
         "italic":  "Helvetica-Oblique",
         "bolditalic": "Helvetica-BoldOblique"}[weight]
    c.setFont(f, size)

def rule_under(c, y, thickness=0.8):
    c.setStrokeColor(BLACK)
    c.setLineWidth(thickness)
    c.line(L, y, R, y)

def section_heading(c, text, y):
    """ALL CAPS bold, full-width rule 2pt below baseline."""
    font(c, "bold", 10.5)
    c.setFillColor(BLACK)
    c.drawString(L, y, text.upper())
    rule_under(c, y - 3)
    return y

def right_text(c, text, y, size=9.5, weight="regular"):
    font(c, weight, size)
    c.setFillColor(DGRAY)
    c.drawRightString(R, y, text)

def left_text(c, text, y, size=9.5, weight="regular", color=None):
    font(c, weight, size)
    c.setFillColor(color or DGRAY)
    c.drawString(L, y, text)

def centered(c, text, y, size=10, weight="regular", color=None):
    font(c, weight, size)
    c.setFillColor(color or BLACK)
    c.drawCentredString(MID, y, text)

def wrap_lines(c, text, size, max_w, weight="regular"):
    """Split text into lines that fit within max_w."""
    font(c, weight, size)
    words  = text.split()
    lines  = []
    cur    = ""
    for w in words:
        test = (cur + " " + w).strip()
        if c.stringWidth(test, "Helvetica" if weight == "regular" else "Helvetica-Bold", size) <= max_w:
            cur = test
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines

def bullet_block(c, bullets, start_y, size=9.5, lh=13, indent=10, max_bullets=5):
    """Draw bullet points. Returns Y after last bullet."""
    font(c, "regular", size)
    c.setFillColor(DGRAY)
    y = start_y
    for b in bullets[:max_bullets]:
        lines = wrap_lines(c, b, size, CW - indent - 8)
        for i, line in enumerate(lines):
            if i == 0:
                c.drawString(L, y, "•")
                c.drawString(L + indent, y, line)
            else:
                c.drawString(L + indent, y, line)
            y -= lh
    return y

# ── generate ──────────────────────────────────────────────────────────────────

def generate(out="base-resume.pdf"):
    c = canvas.Canvas(out, pagesize=letter)
    c.setTitle("Resume")

    # white bg
    c.setFillColor(white)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # ══ NAME ══════════════════════════════════════════════════════════════
    NAME_Y = 735
    font(c, "bold", 22)
    c.setFillColor(BLACK)
    c.drawCentredString(MID, NAME_Y, "Your Full Name")
    COORD["name"] = {"x": MID, "y": NAME_Y, "size": 22, "style": "bold", "align": "center"}

    # ══ CONTACT LINE ══════════════════════════════════════════════════════
    # phone | email | linkedin | github
    CON_Y = NAME_Y - 16
    font(c, "regular", 9)
    c.setFillColor(DGRAY)
    contact = "(000) 000-0000  |  email@email.com  |  linkedin.com/in/yourname  |  github.com/yourname"
    c.drawCentredString(MID, CON_Y, contact)
    COORD["contact_line"] = {"x": MID, "y": CON_Y, "size": 9, "style": "regular", "align": "center"}

    # thin rule under contact
    rule_under(c, CON_Y - 7, thickness=0.4)

    # ══ EDUCATION ═════════════════════════════════════════════════════════
    # Jake's puts Education first (looks good for recent grads + recruiters expect it up top)
    EDU_LABEL_Y = CON_Y - 22
    section_heading(c, "Education", EDU_LABEL_Y)
    COORD["edu_label"] = {"y": EDU_LABEL_Y}

    EDU_ROW1_Y = EDU_LABEL_Y - 17
    # University bold-left | Dates right
    font(c, "bold", 10)
    c.setFillColor(BLACK)
    c.drawString(L, EDU_ROW1_Y, "University Name")
    right_text(c, "City, Country", EDU_ROW1_Y, 9.5, "regular")
    COORD["edu_school"]    = {"x": L,  "y": EDU_ROW1_Y, "size": 10, "style": "bold"}
    COORD["edu_location"]  = {"x2": R, "y": EDU_ROW1_Y, "size": 9.5, "align": "right"}

    EDU_ROW2_Y = EDU_ROW1_Y - 13
    font(c, "italic", 9.5)
    c.setFillColor(DGRAY)
    c.drawString(L, EDU_ROW2_Y, "Bachelor of Science in Computer Science")
    right_text(c, "Aug 2015 – May 2019", EDU_ROW2_Y, 9.5, "italic")
    COORD["edu_degree"] = {"x": L,  "y": EDU_ROW2_Y, "size": 9.5, "style": "italic"}
    COORD["edu_dates"]  = {"x2": R, "y": EDU_ROW2_Y, "size": 9.5, "align": "right"}

    # ══ EXPERIENCE ════════════════════════════════════════════════════════
    EXP_LABEL_Y = EDU_ROW2_Y - 20
    section_heading(c, "Experience", EXP_LABEL_Y)
    COORD["exp_label"] = {"y": EXP_LABEL_Y}

    # ── Job 1 ──
    J1_ROW1_Y = EXP_LABEL_Y - 17
    font(c, "bold", 10)
    c.setFillColor(BLACK)
    c.drawString(L, J1_ROW1_Y, "Company Name, Inc.")
    right_text(c, "City, Country", J1_ROW1_Y, 9.5)
    COORD["job1_company"]  = {"x": L,  "y": J1_ROW1_Y, "size": 10, "style": "bold"}
    COORD["job1_location"] = {"x2": R, "y": J1_ROW1_Y, "size": 9.5, "align": "right"}

    J1_ROW2_Y = J1_ROW1_Y - 13
    font(c, "italic", 9.5)
    c.setFillColor(DGRAY)
    c.drawString(L, J1_ROW2_Y, "Senior Software Engineer")
    right_text(c, "Jan 2022 – Present", J1_ROW2_Y, 9.5, "italic")
    COORD["job1_title"] = {"x": L,  "y": J1_ROW2_Y, "size": 9.5, "style": "italic"}
    COORD["job1_dates"] = {"x2": R, "y": J1_ROW2_Y, "size": 9.5, "align": "right"}

    J1_BULLETS_Y = J1_ROW2_Y - 14
    COORD["job1_bullets"] = {
        "x": L, "startY": J1_BULLETS_Y, "indent": 10,
        "size": 9.5, "lineHeight": 13, "maxBullets": 5
    }
    sample_b1 = [
        "LLM-tailored bullet point highlighting relevant achievement with specific metric",
        "Another bullet rewritten to match the job description requirements precisely",
        "Technical achievement demonstrating depth in the role's core technology stack",
        "Cross-functional impact or leadership example with measurable outcome",
        "Additional contribution tailored specifically to this employer's needs",
    ]
    c.setFillColor(HexColor("#BBBBBB"))
    font(c, "regular", 9.5)
    y = J1_BULLETS_Y
    for b in sample_b1:
        c.drawString(L, y, "•")
        c.drawString(L + 10, y, b[:85])
        y -= 13
    J1_END_Y = y

    # ── Job 2 ──
    J2_ROW1_Y = J1_END_Y - 10
    font(c, "bold", 10)
    c.setFillColor(BLACK)
    c.drawString(L, J2_ROW1_Y, "Previous Company, Ltd.")
    right_text(c, "City, Country", J2_ROW1_Y, 9.5)
    COORD["job2_company"]  = {"x": L,  "y": J2_ROW1_Y, "size": 10, "style": "bold"}
    COORD["job2_location"] = {"x2": R, "y": J2_ROW1_Y, "size": 9.5, "align": "right"}

    J2_ROW2_Y = J2_ROW1_Y - 13
    font(c, "italic", 9.5)
    c.setFillColor(DGRAY)
    c.drawString(L, J2_ROW2_Y, "Software Engineer")
    right_text(c, "Jun 2019 – Dec 2021", J2_ROW2_Y, 9.5, "italic")
    COORD["job2_title"] = {"x": L,  "y": J2_ROW2_Y, "size": 9.5, "style": "italic"}
    COORD["job2_dates"] = {"x2": R, "y": J2_ROW2_Y, "size": 9.5, "align": "right"}

    J2_BULLETS_Y = J2_ROW2_Y - 14
    COORD["job2_bullets"] = {
        "x": L, "startY": J2_BULLETS_Y, "indent": 10,
        "size": 9.5, "lineHeight": 13, "maxBullets": 4
    }
    sample_b2 = [
        "LLM-tailored bullet for this role, metric-driven and specific to requirements",
        "Technical depth demonstrating core competency in the target technology stack",
        "Team or project leadership example with quantified and measurable impact",
        "Relevant achievement matching the employer's stated job requirements",
    ]
    c.setFillColor(HexColor("#BBBBBB"))
    y = J2_BULLETS_Y
    for b in sample_b2:
        c.drawString(L, y, "•")
        c.drawString(L + 10, y, b[:85])
        y -= 13
    J2_END_Y = y

    # ── Job 3 (optional / older role) ──
    J3_ROW1_Y = J2_END_Y - 10
    font(c, "bold", 10)
    c.setFillColor(BLACK)
    c.drawString(L, J3_ROW1_Y, "Earlier Company")
    right_text(c, "City, Country", J3_ROW1_Y, 9.5)
    COORD["job3_company"]  = {"x": L,  "y": J3_ROW1_Y, "size": 10, "style": "bold"}
    COORD["job3_location"] = {"x2": R, "y": J3_ROW1_Y, "size": 9.5, "align": "right"}

    J3_ROW2_Y = J3_ROW1_Y - 13
    font(c, "italic", 9.5)
    c.setFillColor(DGRAY)
    c.drawString(L, J3_ROW2_Y, "Junior Software Engineer")
    right_text(c, "Aug 2017 – May 2019", J3_ROW2_Y, 9.5, "italic")
    COORD["job3_title"] = {"x": L,  "y": J3_ROW2_Y, "size": 9.5, "style": "italic"}
    COORD["job3_dates"] = {"x2": R, "y": J3_ROW2_Y, "size": 9.5, "align": "right"}

    J3_BULLETS_Y = J3_ROW2_Y - 14
    COORD["job3_bullets"] = {
        "x": L, "startY": J3_BULLETS_Y, "indent": 10,
        "size": 9.5, "lineHeight": 13, "maxBullets": 3
    }
    sample_b3 = [
        "Early-career bullet point relevant to the role, concise and specific",
        "Technical contribution with measurable impact or scope",
        "Additional achievement demonstrating growth and initiative",
    ]
    c.setFillColor(HexColor("#BBBBBB"))
    y = J3_BULLETS_Y
    for b in sample_b3:
        c.drawString(L, y, "•")
        c.drawString(L + 10, y, b[:85])
        y -= 13
    J3_END_Y = y

    # ══ PROJECTS (optional — Jake's always has this) ═══════════════════════
    PROJ_LABEL_Y = J3_END_Y - 18
    section_heading(c, "Projects", PROJ_LABEL_Y)
    COORD["proj_label"] = {"y": PROJ_LABEL_Y}

    P1_Y = PROJ_LABEL_Y - 17
    font(c, "bold", 9.5)
    c.setFillColor(BLACK)
    c.drawString(L, P1_Y, "Project Name One")
    font(c, "regular", 9.5)
    c.setFillColor(DGRAY)
    c.drawString(L + c.stringWidth("Project Name One", "Helvetica-Bold", 9.5) + 4,
                 P1_Y, "|  TypeScript, React, PostgreSQL")
    right_text(c, "github.com/you/project", P1_Y, 9)
    COORD["proj1_name"]  = {"x": L, "y": P1_Y, "size": 9.5, "style": "bold"}
    COORD["proj1_stack"] = {"y": P1_Y, "size": 9.5}
    COORD["proj1_link"]  = {"x2": R, "y": P1_Y, "size": 9, "align": "right"}

    P1B_Y = P1_Y - 13
    c.setFillColor(HexColor("#BBBBBB"))
    font(c, "regular", 9.5)
    c.drawString(L, P1B_Y, "•")
    c.drawString(L + 10, P1B_Y, "One-line description of what it does and why it's impressive")
    COORD["proj1_bullets"] = {"x": L, "startY": P1B_Y, "indent": 10, "size": 9.5, "lineHeight": 13, "maxBullets": 2}

    P2_Y = P1B_Y - 18
    font(c, "bold", 9.5)
    c.setFillColor(BLACK)
    c.drawString(L, P2_Y, "Project Name Two")
    font(c, "regular", 9.5)
    c.setFillColor(DGRAY)
    c.drawString(L + c.stringWidth("Project Name Two", "Helvetica-Bold", 9.5) + 4,
                 P2_Y, "|  Python, FastAPI, Redis")
    right_text(c, "github.com/you/project2", P2_Y, 9)
    COORD["proj2_name"]  = {"x": L, "y": P2_Y, "size": 9.5, "style": "bold"}
    COORD["proj2_stack"] = {"y": P2_Y, "size": 9.5}
    COORD["proj2_link"]  = {"x2": R, "y": P2_Y, "size": 9, "align": "right"}

    P2B_Y = P2_Y - 13
    c.setFillColor(HexColor("#BBBBBB"))
    c.drawString(L, P2B_Y, "•")
    c.drawString(L + 10, P2B_Y, "One-line description of what this project does and its scale")
    COORD["proj2_bullets"] = {"x": L, "startY": P2B_Y, "indent": 10, "size": 9.5, "lineHeight": 13, "maxBullets": 2}

    # ══ SKILLS ════════════════════════════════════════════════════════════
    SKL_LABEL_Y = P2B_Y - 20
    section_heading(c, "Technical Skills", SKL_LABEL_Y)
    COORD["skills_label"] = {"y": SKL_LABEL_Y}

    SKL_Y = SKL_LABEL_Y - 16
    # Jake's style: category bold, values regular, on same line
    categories = [
        ("Languages:",  "TypeScript, Python, Go, SQL, Rust"),
        ("Frameworks:", "React, Node.js, FastAPI, Next.js, GraphQL"),
        ("Tools:",      "AWS, Docker, Kubernetes, Terraform, PostgreSQL, Redis"),
    ]
    LH_SKL = 13
    for i, (cat, vals) in enumerate(categories):
        cy = SKL_Y - i * LH_SKL
        font(c, "bold", 9.5)
        c.setFillColor(BLACK)
        c.drawString(L, cy, cat)
        cat_w = c.stringWidth(cat, "Helvetica-Bold", 9.5)
        font(c, "regular", 9.5)
        c.setFillColor(DGRAY)
        c.drawString(L + cat_w + 4, cy, vals)

    COORD["skills_rows"] = {
        "x": L, "startY": SKL_Y, "lineHeight": LH_SKL,
        "size": 9.5, "maxRows": 4,
        "format": "category_bold | values_regular"
    }

    c.save()
    print(f"✓  Saved: {out}")
    return COORD


if __name__ == "__main__":
    coords = generate("base-resume.pdf")
    with open("coordinate_map.json", "w") as f:
        json.dump(coords, f, indent=2)
    print("✓  Saved: coordinate_map.json")
    print(f"\nAll {len(coords)} coordinate entries written.")
