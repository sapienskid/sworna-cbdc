#!/usr/bin/env python3
"""
Sworna CBDC Master Documentation Builder.

Compiles all 45 source markdown documents across the repository into a single,
authoritative master specification (docs/SWORNA-CBDC-MASTER-SPECIFICATION.md),
and converts it into print-quality PDF and reader-friendly EPUB editions.
"""

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DOCS_DIR = REPO_ROOT / "docs"

SYNTHESIS_SRC = DOCS_DIR / "spec-synthesis.md"
MASTER_MD = DOCS_DIR / "SWORNA-CBDC-MASTER-SPECIFICATION.md"
MASTER_EPUB = DOCS_DIR / "sworna-cbdc-specification.epub"
MASTER_PDF = DOCS_DIR / "sworna-cbdc-specification.pdf"

# Frontmatter YAML header
FRONTMATTER = """---
title: "Sworna CBDC: Production-Grade Master Plan & Complete Technical Specification"
subtitle: "A Production-Grade, Two-Tier Sovereign Digital Currency Platform with Zero-Knowledge Privacy and Regulatory Supervisory Oversight"
author:
  - "Sworna Core Engineering & Architecture Working Group"
date: "September 2026"
version: "1.1.0-Production"
lang: "en"
geometry: "margin=1in"
linkcolor: "blue"
urlcolor: "blue"
toccolor: "black"
documentclass: "report"
papersize: "a4"
toc: true
toc-depth: 3
numbersections: true
monofont: "FreeMono"
abstract: |
  This document serves as the authoritative, end-to-end architectural, cryptographic, and operational master plan and complete technical specification for Sworna CBDC—a national retail and wholesale Central Bank Digital Currency platform. Conforming to the Bank for International Settlements (BIS) and G7 two-tier design principles, Sworna CBDC preserves the critical intermediation role of commercial banking institutions while providing the Central Bank with sovereign monetary control, instant real-time settlement finality, and automated AML/CFT compliance.
  
  The platform synthesizes zero-knowledge UTXO token mechanics, IBM Idemix blind credentials, and homomorphic Pedersen commitments atop a Byzantine fault-tolerant Hyperledger Fabric consensus network. This single comprehensive publication embeds the full corpus of project documentation: the executive synthesis, system architecture deep dives, Go Fabric Smart Client (FSC) token flows, FastAPI banking domain models, REST API catalogs, dynamic institutional admission protocols, single-command workshop deployment runbooks for 30+ distributed nodes, all 11 Architecture Decision Records (ADRs), and production scaling design blueprints.
---
"""

# Structural mapping of the corpus: (Part Title, list of (Chapter Title, File Path))
PARTS_STRUCTURE = [
    (
        "Project Roots & Getting Started",
        [
            ("Project Overview (root README)", REPO_ROOT / "README.md"),
            ("Production-Grade Master Plan (SWORNA-PLAN)", REPO_ROOT / "SWORNA-PLAN.md"),
            ("Agent Operating Rules (AGENTS)", REPO_ROOT / "AGENTS.md"),
            ("Team Overview: What Sworna Is (OVERVIEW)", DOCS_DIR / "OVERVIEW.md"),
            ("Authoritative Setup Runbook (SETUP)", DOCS_DIR / "SETUP.md"),
            ("Demo Runbook & UI Reference (DEMO_AND_UI_GUIDE)", DOCS_DIR / "DEMO_AND_UI_GUIDE.md"),
        ],
    ),
    (
        "Architecture & Core Deep Dives",
        [
            ("System Architecture (ARCHITECTURE)", DOCS_DIR / "ARCHITECTURE.md"),
            ("Blind Signatures & Privacy (BLIND-SIGNATURES-AND-PRIVACY)", DOCS_DIR / "BLIND-SIGNATURES-AND-PRIVACY.md"),
            ("AML Compliance Rule Engine (AML-COMPLIANCE)", DOCS_DIR / "AML-COMPLIANCE.md"),
            ("Backend Internals (BACKEND-INTERNALS)", DOCS_DIR / "BACKEND-INTERNALS.md"),
            ("Security Model (SECURITY-MODEL)", DOCS_DIR / "SECURITY-MODEL.md"),
            ("Frontend Portals (FRONTEND)", DOCS_DIR / "FRONTEND.md"),
        ],
    ),
    (
        "Token Network Architecture",
        [
            ("Token Network 01: Overview", DOCS_DIR / "token-network/01-overview.md"),
            ("Token Network 02: Transaction Flow", DOCS_DIR / "token-network/02-transaction-flow.md"),
            ("Token Network 03: UTXO & ZK Model", DOCS_DIR / "token-network/03-utxo-zk-model.md"),
            ("Token Network 04: Chaincode Params", DOCS_DIR / "token-network/04-chaincode-params.md"),
            ("Token Network 05: Engine Deep Dive", DOCS_DIR / "token-network/05-engine-deep-dive.md"),
            ("Token Network 06: API Contracts", DOCS_DIR / "token-network/06-api-contracts.md"),
            ("Token Network 07: Research Log", DOCS_DIR / "token-network/07-research-log.md"),
            ("Token Network 08: Provisioning", DOCS_DIR / "token-network/08-provisioning.md"),
            ("Token Network 09: Distributed Deployment", DOCS_DIR / "token-network/09-distributed-deployment.md"),
        ],
    ),
    (
        "System Operations & Specifications",
        [
            ("Deployment Roles & Progression (DEPLOYMENT)", DOCS_DIR / "DEPLOYMENT.md"),
            ("REST Endpoint Catalog (API)", DOCS_DIR / "API.md"),
            ("Subsystem Checklist (FULL-BANKING-SYSTEM)", DOCS_DIR / "FULL-BANKING-SYSTEM.md"),
            ("Roadmap, WBS & Risks (PHASES)", DOCS_DIR / "PHASES.md"),
            ("Performance Methodology (BENCHMARKS)", DOCS_DIR / "BENCHMARKS.md"),
        ],
    ),
    (
        "Architecture Decision Records (ADRs)",
        [
            ("ADR-0001: Reuse Token SDK", DOCS_DIR / "ADRs/0001-reuse-token-sdk.md"),
            ("ADR-0002: Single Channel Phase 1", DOCS_DIR / "ADRs/0002-single-channel-phase1.md"),
            ("ADR-0003: Raft then SmartBFT", DOCS_DIR / "ADRs/0003-raft-then-smartbft.md"),
            ("ADR-0004: CB Is Issuer and Auditor", DOCS_DIR / "ADRs/0004-cb-is-issuer-and-auditor.md"),
            ("ADR-0005: Python Off-Chain Only", DOCS_DIR / "ADRs/0005-python-offchain-only.md"),
            ("ADR-0006: UTXO DLog ZK", DOCS_DIR / "ADRs/0006-utxo-dlog-zk.md"),
            ("ADR-0007: CouchDB", DOCS_DIR / "ADRs/0007-couchdb.md"),
            ("ADR-0008: Two-Tier Hybrid", DOCS_DIR / "ADRs/0008-two-tier-hybrid.md"),
            ("ADR-0009: SWR Token Definition", DOCS_DIR / "ADRs/0009-swr-token-definition.md"),
            ("ADR-0010: Own Token Layer", DOCS_DIR / "ADRs/0010-own-token-layer.md"),
            ("ADR-0011: AML Off-Chain Rule Engine", DOCS_DIR / "ADRs/0011-aml-offchain-rule-engine.md"),
        ],
    ),
    (
        "Scaling Plans & Appendices",
        [
            ("Design Note: Unified Deployment CLI (2026-09-04)", DOCS_DIR / "plans/2026-09-04-unified-deployment-cli-design.md"),
            ("Design Note: Automated Docker Bank Onboarding (2026-09-05)", DOCS_DIR / "plans/2026-09-05-automated-docker-bank-onboarding-design.md"),
            ("Design Note: Distributed Scaling Plan (2026-09-06)", DOCS_DIR / "plans/2026-09-06-distributed-scaling-implementation-plan.md"),
            ("Design Note: Unlimited Banks & Customers Architecture (2026-09-06)", DOCS_DIR / "plans/2026-09-06-distributed-system-unlimited-banks-customers-design.md"),
            ("Execution Status & Handoff (2026-09-06)", DOCS_DIR / "plans/2026-09-06-execution-status.md"),
            ("Network Layer Notes (network README)", REPO_ROOT / "network/README.md"),
            ("Bibliography (REFERENCES)", DOCS_DIR / "REFERENCES.md"),
            ("Documentation Index (docs README)", DOCS_DIR / "README.md"),
        ],
    ),
]

EMOJI_REPLACEMENTS = {
    "✅": "[PASS]",
    "❌": "[FAIL]",
    "⚠️": "[WARN]",
    "⚠": "[WARN]",
    "⛔": "[BLOCKED]",
    "🔶": "[PARTIAL]",
    "⬜": "[ ]",
    "✔": "[PASS]",
    "✘": "[FAIL]",
}


def sanitize_text(text: str) -> str:
    """Normalize emojis to standard textual markers for pristine LaTeX rendering."""
    for emoji, replacement in EMOJI_REPLACEMENTS.items():
        text = text.replace(emoji, replacement)
    return text


def strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter block if present."""
    if text.startswith("---"):
        m = re.match(r"^---\n.*?\n---\n+", text, re.DOTALL)
        if m:
            return text[m.end():]
    return text


def demote_headings(text: str, levels: int = 1) -> str:
    """Demote markdown headings by N levels, preserving fenced code blocks intact."""
    out = []
    in_fence = False
    prefix = "#" * levels

    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if not in_fence:
            m = re.match(r"^(#{1,5})(\s+.*)$", line)
            if m:
                out.append(prefix + m.group(1) + m.group(2))
                continue
        out.append(line)
    return "\n".join(out)


def flatten_md_links(text: str) -> str:
    """Convert relative .md file links to bold text so no broken links occur in PDF/EPUB."""
    def repl(m):
        label, target = m.group(1), m.group(2)
        if target.strip().endswith(".md") or ".md#" in target:
            return f"**{label}**"
        return m.group(0)
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", repl, text)


def build_unified_markdown() -> None:
    """Read all source files and assemble docs/SWORNA-CBDC-MASTER-SPECIFICATION.md."""
    print("==> Assembling unified master specification markdown...")
    parts = [FRONTMATTER.strip(), "", "\\newpage", ""]

    # PART I: Executive Synthesis & Master Plan
    print("  -> Processing Part I: Executive Synthesis & Master Plan")
    if not SYNTHESIS_SRC.exists():
        raise FileNotFoundError(f"Missing Part I synthesis source: {SYNTHESIS_SRC}")
    
    synthesis_body = SYNTHESIS_SRC.read_text(encoding="utf-8").strip()
    synthesis_body = sanitize_text(synthesis_body)
    synthesis_body = flatten_md_links(synthesis_body)
    # Demote headings by 1 level so each becomes a Chapter (##) under Part I (#)
    synthesis_body = demote_headings(synthesis_body, levels=1)

    parts.append("# Part I: Executive Synthesis & Master Plan")
    parts.append("")
    parts.append("> Curated high-level specification covering the two-tier macroeconomic design, cryptographic UTXO token mechanics, Go FSC flows, FastAPI backend architecture, dynamic institutional admission, AML compliance, and stakeholder defenses.")
    parts.append("")
    parts.append("\\newpage")
    parts.append("")
    parts.append(synthesis_body)
    parts.append("")
    parts.append("*End of Part I (Executive Synthesis) — Complete corpus of technical documentation follows in Parts II through VII.*")
    parts.append("")
    parts.append("\\newpage")

    # Document Map / Sequenced Index (unnumbered chapter under Part I)
    parts.append("## Document Map & Repository Index {-}")
    parts.append("")
    parts.append("The complete corpus of 45 repository markdown documents is embedded sequentially across Parts II through VII in authoritative reading order.")
    parts.append("")
    parts.append("| Part | Embedded Source | Relative Path |")
    parts.append("|:---|:---|:---|")

    for part_idx, (part_title, chapters) in enumerate(PARTS_STRUCTURE, start=2):
        roman_part = ["II", "III", "IV", "V", "VI", "VII"][part_idx - 2]
        for ch_title, ch_path in chapters:
            try:
                rel = ch_path.relative_to(REPO_ROOT)
            except ValueError:
                rel = ch_path
            parts.append(f"| Part {roman_part}: {part_title} | {ch_title} | `{rel}` |")

    parts.append("")
    parts.append("\\newpage")

    # PARTS II through VII
    for part_idx, (part_title, chapters) in enumerate(PARTS_STRUCTURE, start=2):
        roman_part = ["II", "III", "IV", "V", "VI", "VII"][part_idx - 2]
        print(f"  -> Processing Part {roman_part}: {part_title} ({len(chapters)} chapters)")
        
        parts.append(f"# Part {roman_part}: {part_title}")
        parts.append("")
        parts.append(f"> Embedded primary documentation for Part {roman_part} ({part_title}).")
        parts.append("")
        parts.append("\\newpage")
        parts.append("")

        for ch_title, ch_path in chapters:
            try:
                rel_path = ch_path.relative_to(REPO_ROOT)
            except ValueError:
                rel_path = ch_path

            if not ch_path.exists():
                print(f"     [WARN] Missing source file: {ch_path}")
                parts.append(f"## {ch_title}")
                parts.append(f"> *Source file missing: `{rel_path}`*")
                parts.append("")
                continue

            raw_text = ch_path.read_text(encoding="utf-8")
            body = strip_frontmatter(raw_text).strip()
            body = sanitize_text(body)
            body = flatten_md_links(body)

            # Strip the very first top-level header if it is identical/redundant to ch_title
            lines = body.split("\n")
            if lines and re.match(r"^#\s+", lines[0]):
                body = "\n".join(lines[1:]).strip()

            # Demote remaining headings by 1 level (so ## becomes ### section, etc.)
            body = demote_headings(body, levels=1)

            parts.append(f"## {ch_title}")
            parts.append("")
            parts.append(f"> *Source: `{rel_path}`*")
            parts.append("")
            parts.append(body)
            parts.append("")
            parts.append("\\newpage")
            parts.append("")

    parts.append("---")
    parts.append("")
    parts.append("*End of Publication — Sworna CBDC Production-Grade Master Plan & Complete Technical Specification (v1.1.0-Production).*")
    parts.append("")

    full_content = "\n".join(parts) + "\n"
    MASTER_MD.write_text(full_content, encoding="utf-8")
    line_count = sum(1 for _ in open(MASTER_MD, encoding="utf-8"))
    byte_size = MASTER_MD.stat().st_size
    print(f"[OK] Wrote {MASTER_MD} ({line_count:,} lines, {byte_size / 1024:.1f} KB)")


def check_dependencies() -> None:
    """Ensure pandoc and xelatex are available on the host."""
    if not shutil.which("pandoc"):
        print("[ERROR] 'pandoc' is not installed or not in PATH.", file=sys.stderr)
        sys.exit(1)
    if not shutil.which("xelatex"):
        print("[ERROR] 'xelatex' is not installed or not in PATH.", file=sys.stderr)
        sys.exit(1)


def compile_epub() -> None:
    """Compile docs/SWORNA-CBDC-MASTER-SPECIFICATION.md into EPUB."""
    print("==> Compiling EPUB publication...")
    start_t = time.time()
    cmd = [
        "pandoc",
        str(MASTER_MD),
        "-o",
        str(MASTER_EPUB),
        "--top-level-division=part",
        "--toc",
        "--toc-depth=3",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[ERROR] EPUB generation failed:\n{res.stderr}", file=sys.stderr)
        sys.exit(res.returncode)
    dur = time.time() - start_t
    size_kb = MASTER_EPUB.stat().st_size / 1024
    print(f"[OK] Generated {MASTER_EPUB} ({size_kb:.1f} KB in {dur:.2f}s)")


def compile_pdf() -> None:
    """Compile docs/SWORNA-CBDC-MASTER-SPECIFICATION.md into PDF via XeLaTeX."""
    print("==> Compiling PDF publication via XeLaTeX (this may take ~1-2 minutes)...")
    start_t = time.time()
    cmd = [
        "pandoc",
        str(MASTER_MD),
        "-o",
        str(MASTER_PDF),
        "--pdf-engine=xelatex",
        "--top-level-division=part",
        "--toc",
        "--toc-depth=3",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[ERROR] PDF generation failed:\n{res.stderr}", file=sys.stderr)
        sys.exit(res.returncode)
    dur = time.time() - start_t
    size_kb = MASTER_PDF.stat().st_size / 1024
    print(f"[OK] Generated {MASTER_PDF} ({size_kb:.1f} KB in {dur:.2f}s)")


def main():
    check_dependencies()
    build_unified_markdown()
    compile_epub()
    compile_pdf()
    print("\n========================================================")
    print(" Sworna CBDC Master Documentation Build Complete!")
    print(f" - Markdown : {MASTER_MD}")
    print(f" - EPUB     : {MASTER_EPUB}")
    print(f" - PDF      : {MASTER_PDF}")
    print("========================================================")


if __name__ == "__main__":
    main()
