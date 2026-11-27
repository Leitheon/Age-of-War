# Builds Age of War's sign-in page look into server/public (Fox, Nov 27 2026: "change the main webpage where players
# log in and register to something generic that doesn't use DoA's assets"). Everything is made here or is free to
# ship: the campaign map is drawn below, the fonts are Cinzel and Alegreya Sans (SIL Open Font License, fonts/).
#   - assets/aow-map-*.svg: contour lines and the world's coordinate grid (100 fields a square), behind the page.
#   - assets/aow-march-*.svg, aow-historic-*.svg: a lord's city, his army marching on an enemy city; a Historic City.
#   - assets/login-aow*.css from login.css, loaded after the client's own stylesheet (index.html).
#   - The client bundle loses the login page's smoke, fire glow and embers (they belonged to the old painting).
# Every file is named by its content, as the client's bundle is: the offline cache (sw.js) keeps a file forever.
# Usage: python3 build.py [server/public]   (numpy and contourpy, which matplotlib brings)
import os, re, sys, glob, math, hashlib, shutil
import numpy as np
import contourpy

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'public'))
ASSETS = os.path.join(PUB, 'assets')
BRASS, RED, PARCH = '#c9a14e', '#b54a34', '#efe4c8'

def h8(data): return hashlib.sha256(data).hexdigest()[:8]

def rdp(pts, eps):
    """Ramer-Douglas-Peucker: drop points that stay within eps of the line between their neighbours."""
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; ab = b - a; n = np.hypot(*ab)
    rel = pts - a
    d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / n if n else np.hypot(rel[:, 0], rel[:, 1])
    i = int(np.argmax(d))
    if d[i] <= eps: return np.array([a, b])
    return np.vstack([rdp(pts[:i + 1], eps)[:-1], rdp(pts[i:], eps)])

def path(pts):
    q = np.rint(pts).astype(int)
    keep = [q[0]] + [p for j, p in enumerate(q[1:], 1) if (p != q[j - 1]).any()]
    return 'M' + ' '.join(f'{x} {y}' for x, y in keep)

def campaign_map():
    """Hills and valleys from a fixed seed (the same map every build), their contours, and the coordinate grid."""
    W, H, step = 1600, 1000, 5
    xs, ys = np.arange(0, W + step, step, dtype=float), np.arange(0, H + step, step, dtype=float)
    X, Y = np.meshgrid(xs, ys)
    rng = np.random.default_rng(1811)
    z = np.zeros_like(X)
    for _ in range(26):
        cx, cy = rng.uniform(-100, W + 100), rng.uniform(-100, H + 100)
        sx, sy, amp, th = rng.uniform(70, 260), rng.uniform(60, 200), rng.uniform(-0.8, 1.6), rng.uniform(0, math.pi)
        u, v = (X - cx) * math.cos(th) + (Y - cy) * math.sin(th), -(X - cx) * math.sin(th) + (Y - cy) * math.cos(th)
        z += amp * np.exp(-(u / sx) ** 2 - (v / sy) ** 2)
    for _ in range(7):    # long ridges and folds
        k, th, ph, amp = rng.uniform(0.004, 0.012), rng.uniform(0, math.pi), rng.uniform(0, 6.3), rng.uniform(0.05, 0.16)
        z += amp * np.sin(k * (X * math.cos(th) + Y * math.sin(th)) + ph)
    gen = contourpy.contour_generator(xs, ys, z)
    levels = np.linspace(z.min(), z.max(), 26)[1:-1]
    thin, thick = [], []
    for i, lv in enumerate(levels):
        for line in gen.lines(lv):
            if len(line) < 6: continue
            pts = rdp(np.asarray(line), 1.4)
            if len(pts) >= 2: (thick if i % 5 == 2 else thin).append(path(pts))
    grid = ' '.join([f'M{x} 0V{H}' for x in range(100, W, 100)] + [f'M0 {y}H{W}' for y in range(100, H, 100)])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">'
            f'<g fill="none" vector-effect="non-scaling-stroke" stroke-linejoin="round">'
            f'<path d="{grid}" stroke="{BRASS}" stroke-opacity=".11" stroke-width="1"/>'
            f'<path d="{" ".join(thin)}" stroke="#4a6577" stroke-opacity=".55" stroke-width="1"/>'
            f'<path d="{" ".join(thick)}" stroke="#6a879a" stroke-opacity=".6" stroke-width="1.6"/>'
            f'</g></svg>')

def march():
    """A lord's city (brass) and his army's march, dotted, on an enemy city (red)."""
    home, foe = (58, 286), (372, 64)
    p0, c1, c2, p3 = (82, 270), (176, 246), (214, 130), (346, 80)
    ang = math.atan2(p3[1] - c2[1], p3[0] - c2[0])
    def rot(dx, dy): return (p3[0] + dx * math.cos(ang) - dy * math.sin(ang), p3[1] + dx * math.sin(ang) + dy * math.cos(ang))
    chev = ' '.join(f'{x:.1f} {y:.1f}' for x, y in (rot(-11, -7), rot(0, 0), rot(-11, 7)))
    hx, hy = home; fx, fy = foe
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 340">'
            f'<circle cx="{hx}" cy="{hy}" r="27" fill="none" stroke="{BRASS}" stroke-opacity=".35" stroke-width="1.5"/>'
            f'<rect x="{hx - 12}" y="{hy - 12}" width="24" height="24" fill="#1c2933" stroke="{BRASS}" stroke-width="2.5"/>'
            f'<rect x="{hx - 5}" y="{hy - 5}" width="10" height="10" fill="{BRASS}"/>'
            f'<path d="M{p0[0]} {p0[1]}C{c1[0]} {c1[1]} {c2[0]} {c2[1]} {p3[0]} {p3[1]}" fill="none" stroke="{BRASS}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="0.5 11"/>'
            f'<path d="M{chev}" fill="none" stroke="{BRASS}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{fx}" cy="{fy}" r="27" fill="none" stroke="{RED}" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="4 5"/>'
            f'<rect x="{fx - 11}" y="{fy - 11}" width="22" height="22" transform="rotate(45 {fx} {fy})" fill="#1c2933" stroke="{RED}" stroke-width="2.5"/>'
            f'<circle cx="{fx}" cy="{fy}" r="4.5" fill="{RED}"/>'
            '</svg>')

def historic():
    """A Historic City: a star in a double ring, with its four bearings."""
    pts = []
    for i in range(10):
        r, a = (17 if i % 2 == 0 else 7.2), -math.pi / 2 + i * math.pi / 5
        pts.append(f'{50 + r * math.cos(a):.1f} {50 + r * math.sin(a):.1f}')
    ticks = 'M50 2V10M50 90V98M2 50H10M90 50H98'
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<circle cx="50" cy="50" r="36" fill="#1c2933" fill-opacity=".6" stroke="{BRASS}" stroke-width="1.6"/>'
            f'<circle cx="50" cy="50" r="30" fill="none" stroke="{BRASS}" stroke-opacity=".55" stroke-width="1"/>'
            f'<path d="{ticks}" stroke="{BRASS}" stroke-width="1.6" stroke-linecap="round"/>'
            f'<path d="M{" ".join(pts)}Z" fill="{BRASS}"/>'
            '</svg>')

def put(prefix, ext, data):
    """Write assets/<prefix>-<hash>.<ext>, dropping the earlier builds of it; returns its address."""
    for old in glob.glob(os.path.join(ASSETS, f'{prefix}-*.{ext}')): os.remove(old)
    name = f'{prefix}-{h8(data)}.{ext}'
    with open(os.path.join(ASSETS, name), 'wb') as f: f.write(data)
    return '/assets/' + name

def main():
    urls = {
        'map': put('aow-map', 'svg', campaign_map().encode()),
        'march': put('aow-march', 'svg', march().encode()),
        'historic': put('aow-historic', 'svg', historic().encode()),
    }
    for key, file in (('cinzel400', 'cinzel-latin-400-normal'), ('cinzel700', 'cinzel-latin-700-normal'),
                      ('sans400', 'alegreya-sans-latin-400-normal'), ('sans700', 'alegreya-sans-latin-700-normal')):
        urls[key] = put('aow-' + file.replace('-latin', '').replace('-normal', ''), 'woff2', open(os.path.join(HERE, 'fonts', file + '.woff2'), 'rb').read())
    for lic in ('Cinzel-OFL.txt', 'AlegreyaSans-OFL.txt'): shutil.copyfile(os.path.join(HERE, 'fonts', lic), os.path.join(ASSETS, lic))
    css = open(os.path.join(HERE, 'login.css'), encoding='utf-8').read()
    css = re.sub(r'\{(\w+)\}', lambda m: urls[m.group(1)] if m.group(1) in urls else m.group(0), css)
    for old in glob.glob(os.path.join(ASSETS, 'login-aow*.css')): os.remove(old)
    data = css.encode('utf-8'); css_name = 'login-aow' + h8(data) + '.css'
    open(os.path.join(ASSETS, css_name), 'wb').write(data)

    html_p = os.path.join(PUB, 'index.html'); html = open(html_p, encoding='utf-8').read()
    link = f'<link rel="stylesheet" href="/assets/{css_name}" />'
    if re.search(r'<link rel="stylesheet" href="/assets/login-aow\w+\.css" />', html):
        html = re.sub(r'<link rel="stylesheet" href="/assets/login-aow\w+\.css" />', link, html)
    else:
        m = re.search(r'(\s*)(<link rel="stylesheet" crossorigin href="/assets/index-aow\w+\.css" />)', html)
        html = html.replace(m.group(0), m.group(0) + m.group(1) + link)

    # The bundle: the login page draws no smoke canvas (its fire and embers).
    name = re.search(r'/assets/(index-aow[0-9a-f]+\.js)', html).group(1)
    js = open(os.path.join(ASSETS, name), encoding='utf-8').read()
    js2 = re.sub(r'(t\.jsx\("div",\{className:"login-haze"\}\),)t\.jsx\(\w+,\{\}\),', r'\1', js, count=1)
    if js2 != js:
        data = js2.encode('utf-8'); nn = 'index-aow' + h8(data) + '.js'
        open(os.path.join(ASSETS, nn), 'wb').write(data)
        if nn != name: os.remove(os.path.join(ASSETS, name))
        html = html.replace(name, nn); print(name, '->', nn)
    open(html_p, 'w', encoding='utf-8').write(html)
    print(css_name, *urls.values(), sep='\n')

if __name__ == '__main__':
    main()
