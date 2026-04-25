"""
Generate the particlised logo SVG for LLMFIXER / The Fixer.

Skeleton: option #02 (asymmetric radial cluster) — central focal node + 6 satellites
including one bright "alpha" — rendered as actual particle clusters, where
the particles are cold dim matter and *light only emerges where they meet*.

v3 — emergent-light pass. The physical model:
  - Atoms/particles do not shine. They are dim, near-monochrome cold matter.
  - Brightness and color only emerge at *meeting points* — cluster centers,
    sub-density peaks, supernova events. These are rendered as ignition
    glows whose color comes from the cluster's signature temperature.
  - Density (lots of low-alpha particles overlapping) naturally produces
    radial brightness gradients without per-particle tinting.

Particle classes:
- particle  — tiny, low-alpha cold matter. Same dim color everywhere.
- ignition  — radial-gradient glow placed at every meeting point. Source of color.
- supernova — rare bright sharp event with halo, only at the brightest meets.
- nebula    — large soft atmospheric glow behind brightest clusters.
- filament  — hairline curved thread, atomic-bond hint inside brightest clusters.

Run:  python3 scripts/generate-logo.py > public/logo-options/02-asymmetric-particlised.svg
"""

import random
import math
import sys

random.seed(7)  # deterministic brand mark; runtime uses per-visitor seed

W, H = 200, 200

# ---------------------------------------------------------------------------
# Cluster definitions — node positions + per-node particle/ignition mix
# ---------------------------------------------------------------------------

NODES = [
    # name, cx, cy, sigma, mix
    ("core",  100, 100, 19, {
        "particles": 4800, "supernova": 6, "nebula": 1,
        "filament": 32, "subpeaks": 5, "color": "warm_cream",
        "ignite_main_r": 17, "ignite_main_intensity": 0.70,
    }),
    ("alpha", 148, 62,   8, {
        "particles": 1200, "supernova": 3, "nebula": 1,
        "filament": 12, "subpeaks": 3, "color": "warm_cream",
        "ignite_main_r": 9, "ignite_main_intensity": 0.62,
    }),
    ("sat_b", 62,  58,   7, {"particles": 780, "supernova": 0, "nebula": 0, "filament": 0, "subpeaks": 1, "color": "cool_blue", "ignite_main_r": 7,  "ignite_main_intensity": 0.55}),
    ("sat_c", 38,  118,  6, {"particles": 560, "supernova": 0, "nebula": 0, "filament": 0, "subpeaks": 1, "color": "cool_blue", "ignite_main_r": 6,  "ignite_main_intensity": 0.50}),
    ("sat_d", 92,  172,  7, {"particles": 720, "supernova": 0, "nebula": 0, "filament": 0, "subpeaks": 1, "color": "cool_blue", "ignite_main_r": 7,  "ignite_main_intensity": 0.55}),
    ("sat_e", 166, 138,  6, {"particles": 520, "supernova": 0, "nebula": 0, "filament": 0, "subpeaks": 0, "color": "cool_blue", "ignite_main_r": 5,  "ignite_main_intensity": 0.45}),
    ("sat_f", 134, 34,   5, {"particles": 400, "supernova": 0, "nebula": 0, "filament": 0, "subpeaks": 0, "color": "cool_blue", "ignite_main_r": 4,  "ignite_main_intensity": 0.40}),
]

BACKGROUND_PARTICLES = 2400

# Cluster signature colors used ONLY at ignition points.
# warm_cream replaces the saturated gold — pale, less yellow, more "warm starlight"
IGNITION_COLOR = {
    "warm_cream": {
        "core_hot": "#FFFFFF",
        "ring":     "#F0E0BC",   # was #F0C45A — pulled toward cream
        "outer":    "#C8B89A",   # was #D4A853 — soft tan
    },
    "cool_blue": {
        "core_hot": "#FFFFFF",
        "ring":     "#9FCBF5",   # slightly softer than #6BB8FF
        "outer":    "#6E9AD8",
    },
}

# Cold-matter particle palette — atoms.
# Dim and near-monochromatic, but with subtle hue variation so they don't
# look like a uniform fog.  No saturated colors here — that's reserved for
# ignition glows.
COLD_PALETTE = [
    "#C5D4F0", "#A8C6F0", "#D8E2F5", "#9FBAE0", "#B0C8E8",
    "#E8ECF5", "#D0DCF0", "#BDD0EC",
]
COLD_NEUTRAL = ["#E8ECF5", "#F0E8D8", "#F5EFE0"]  # very rare neutral/cream tint to break monotony

# ---------------------------------------------------------------------------
# Random helpers
# ---------------------------------------------------------------------------

def gauss_2d(cx, cy, sigma):
    return cx + random.gauss(0, sigma), cy + random.gauss(0, sigma)

# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------

def render_particle(x, y):
    """Cold dim matter — atoms.  They don't shine; they're visible because
    they're material.  Trimodal visibility so the eye can pick out
    individual atoms without losing the textural mass that creates the
    cluster shapes."""
    # Color — mostly the cool palette; occasional neutral break
    if random.random() < 0.08:
        color = random.choice(COLD_NEUTRAL)
    else:
        color = random.choice(COLD_PALETTE)

    # Trimodal visibility — texture (60%) + mid (30%) + discrete (10%)
    roll = random.random()
    if roll < 0.60:
        r = random.uniform(0.12, 0.30)
        op = random.uniform(0.20, 0.38)
    elif roll < 0.90:
        r = random.uniform(0.24, 0.46)
        op = random.uniform(0.36, 0.62)
    else:
        # The atoms you can clearly see — discrete points
        r = random.uniform(0.36, 0.62)
        op = random.uniform(0.62, 0.88)

    return f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r:.2f}" fill="{color}" fill-opacity="{op:.2f}"/>'

def render_ignition(x, y, radius, color_set, idx, intensity=1.0):
    """Soft glow that emerges at meeting points. The source of color."""
    grad_id = f"ig{idx}"
    inner_op = 0.55 * intensity
    mid_op = 0.18 * intensity
    grad_def = (
        f'<radialGradient id="{grad_id}" cx="50%" cy="50%" r="50%">'
        f'<stop offset="0%" stop-color="{color_set["core_hot"]}" stop-opacity="{inner_op:.2f}"/>'
        f'<stop offset="35%" stop-color="{color_set["ring"]}" stop-opacity="{mid_op:.2f}"/>'
        f'<stop offset="100%" stop-color="{color_set["outer"]}" stop-opacity="0"/>'
        f'</radialGradient>'
    )
    body = f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{radius:.2f}" fill="url(#{grad_id})"/>'
    return grad_def, body

def render_supernova(x, y, color_set, idx):
    grad_id = f"sn{idx}"
    flare_id = f"sn{idx}f"
    halo_r = random.uniform(8, 13)
    flare_r = random.uniform(2.2, 3.6)
    core_r = random.uniform(0.7, 1.2)
    grad_def = (
        f'<radialGradient id="{grad_id}" cx="50%" cy="50%" r="50%">'
        f'<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.85"/>'
        f'<stop offset="22%" stop-color="{color_set["ring"]}" stop-opacity="0.45"/>'
        f'<stop offset="100%" stop-color="{color_set["outer"]}" stop-opacity="0"/>'
        f'</radialGradient>'
        f'<radialGradient id="{flare_id}" cx="50%" cy="50%" r="50%">'
        f'<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>'
        f'<stop offset="60%" stop-color="#FFFFFF" stop-opacity="0"/>'
        f'</radialGradient>'
    )
    halo = f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{halo_r:.2f}" fill="url(#{grad_id})"/>'
    flare = f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{flare_r:.2f}" fill="url(#{flare_id})"/>'
    core = f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{core_r:.2f}" fill="#FFFFFF"/>'
    return grad_def, f"{halo}\n{flare}\n{core}"

def render_nebula(x, y, color_set, sigma, idx):
    grad_id = f"neb{idx}"
    base = color_set["ring"]
    r = sigma * random.uniform(2.6, 3.6)
    grad_def = (
        f'<radialGradient id="{grad_id}" cx="50%" cy="50%" r="50%">'
        f'<stop offset="0%" stop-color="{base}" stop-opacity="0.10"/>'
        f'<stop offset="55%" stop-color="{base}" stop-opacity="0.04"/>'
        f'<stop offset="100%" stop-color="{base}" stop-opacity="0"/>'
        f'</radialGradient>'
    )
    body = f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r:.2f}" fill="url(#{grad_id})"/>'
    return grad_def, body

def render_filament(cx, cy, sigma, color_set):
    a1 = random.uniform(0, math.tau)
    a2 = a1 + random.uniform(math.pi * 0.3, math.pi * 1.4)
    r1 = random.uniform(sigma * 0.4, sigma * 1.6)
    r2 = random.uniform(sigma * 0.4, sigma * 1.6)
    x1 = cx + math.cos(a1) * r1
    y1 = cy + math.sin(a1) * r1
    x2 = cx + math.cos(a2) * r2
    y2 = cy + math.sin(a2) * r2
    cxp = cx + (random.random() - 0.5) * sigma * 0.6
    cyp = cy + (random.random() - 0.5) * sigma * 0.6
    color = color_set["ring"]
    op = random.uniform(0.10, 0.30)
    sw = random.uniform(0.12, 0.32)
    return (f'<path d="M {x1:.2f} {y1:.2f} Q {cxp:.2f} {cyp:.2f} {x2:.2f} {y2:.2f}" '
            f'stroke="{color}" stroke-width="{sw:.2f}" stroke-opacity="{op:.2f}" '
            f'fill="none" stroke-linecap="round"/>')

# ---------------------------------------------------------------------------
# Build SVG
# ---------------------------------------------------------------------------

defs = []
nebula_layer = []
particle_layer = []  # all the dim cold matter
filament_layer = []
ignition_layer = []  # gradient glows at meeting points (the only color source)
supernova_layer = []  # the brightest events

# Background cosmic dust — same cold-matter rules, page-wide
for _ in range(BACKGROUND_PARTICLES):
    x = random.uniform(0, W)
    y = random.uniform(0, H)
    particle_layer.append(render_particle(x, y))

ig_idx = 0
sn_idx = 0
neb_idx = 0

for name, cx, cy, sigma, mix in NODES:
    color_set = IGNITION_COLOR[mix["color"]]

    # Sub-cluster density peaks
    subpeaks = []
    for _ in range(mix.get("subpeaks", 0)):
        spx, spy = gauss_2d(cx, cy, sigma * 0.55)
        sps = sigma * random.uniform(0.30, 0.50)
        subpeaks.append((spx, spy, sps))

    # Nebula behind cluster
    for _ in range(mix.get("nebula", 0)):
        grad, body = render_nebula(cx, cy, color_set, sigma, neb_idx)
        defs.append(grad); nebula_layer.append(body); neb_idx += 1

    # Particles — dim cold matter. Distribution split between main cluster + sub-peaks.
    total = mix.get("particles", 0)
    main_count = int(total * 0.70)
    sub_count = total - main_count

    # Main cluster — Gaussian
    for _ in range(main_count):
        x, y = gauss_2d(cx, cy, sigma)
        particle_layer.append(render_particle(x, y))

    # Sub-peaks — concentrated micro-clusters
    if subpeaks and sub_count > 0:
        per_peak = sub_count // len(subpeaks)
        for spx, spy, ssig in subpeaks:
            for _ in range(per_peak):
                x, y = gauss_2d(spx, spy, ssig)
                particle_layer.append(render_particle(x, y))

    # Filaments
    for _ in range(mix.get("filament", 0)):
        filament_layer.append(render_filament(cx, cy, sigma, color_set))

    # IGNITION glows — the only colored emission. Where particles meet.
    # 1. Main centroid
    grad, body = render_ignition(cx, cy, mix["ignite_main_r"], color_set, ig_idx, mix["ignite_main_intensity"])
    defs.append(grad); ignition_layer.append(body); ig_idx += 1
    # 2. Each sub-peak gets a smaller ignition
    for spx, spy, ssig in subpeaks:
        sub_r = mix["ignite_main_r"] * 0.55
        sub_i = mix["ignite_main_intensity"] * 0.65
        grad, body = render_ignition(spx, spy, sub_r, color_set, ig_idx, sub_i)
        defs.append(grad); ignition_layer.append(body); ig_idx += 1

    # Supernovae — bright sharp events at the densest meeting points
    for _ in range(mix.get("supernova", 0)):
        x, y = gauss_2d(cx, cy, sigma * 0.55)
        grad, body = render_supernova(x, y, color_set, sn_idx)
        defs.append(grad); supernova_layer.append(body); sn_idx += 1

# ---------------------------------------------------------------------------
# Compose + emit
# ---------------------------------------------------------------------------

out = []
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
out.append('<defs>')
out.extend(defs)
out.append('</defs>')
out.append(f'<rect width="{W}" height="{H}" fill="#0A0E1A"/>')
out.extend(nebula_layer)        # 1. atmospheric glow behind everything
out.extend(particle_layer)       # 2. cold dim matter — the atoms
out.extend(ignition_layer)       # 3. emergent color at meeting points
out.extend(filament_layer)       # 4. atomic bonds (fine threads)
out.extend(supernova_layer)      # 5. the brightest events on top
out.append('</svg>')

sys.stdout.write("\n".join(out))
