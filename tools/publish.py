"""Lock the cost data into the website.

    python3 tools/publish.py --open          # unlock data/costs.enc.json into tools/costs.json to edit it
    python3 tools/publish.py                 # after editing tools/costs.json: make photos, lock, write data/
    python3 tools/publish.py --new-password  # make a new password and re-lock

tools/costs.json and tools/password.txt are git-ignored: this repo is public, so only the locked
data/costs.enc.json is committed. The password is also read from AKURATI_PASSWORD, or asked for.
Lock: AES-256-GCM, key from the password with PBKDF2-SHA256; assets/app.js unlocks it in the browser.
"""
import base64, getpass, json, os, secrets, sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from PIL import Image

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
DATA, PASSWORD, LOCKED = HERE / 'costs.json', HERE / 'password.txt', SITE / 'data' / 'costs.enc.json'
OLD_SHOP_PHOTOS = SITE.parent / 'vajra' / 'odoo' / 'img'   # used only while that folder still exists
ITERATIONS = 600_000                                       # stored in the file; app.js reads it from there
THUMB = (480, 600)                                         # 4:5, like the shop photos


def key(password, salt, iterations):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations).derive(password.encode())


def get_password():
    if PASSWORD.exists():
        return PASSWORD.read_text().strip()
    pw = os.environ.get('AKURATI_PASSWORD') or getpass.getpass('Website password: ')
    PASSWORD.write_text(pw + '\n')
    return pw


def new_password():
    abc = 'abcdefghjkmnpqrstuvwxyz23456789'     # no 0/o, 1/l/i
    return '-'.join(''.join(secrets.choice(abc) for _ in range(4)) for _ in range(4))


def unlock(password):
    f = json.loads(LOCKED.read_text())
    b = lambda s: base64.b64decode(s)
    plain = AESGCM(key(password, b(f['salt']), f['iter'])).decrypt(b(f['iv']), b(f['data']), None)
    return json.loads(plain)


def lock(data, password):
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    blob = AESGCM(key(password, salt, ITERATIONS)).encrypt(iv, json.dumps(data, ensure_ascii=False).encode(), None)
    b64 = lambda x: base64.b64encode(x).decode()
    return {'v': 1, 'kdf': 'PBKDF2-SHA256', 'iter': ITERATIONS, 'salt': b64(salt), 'iv': b64(iv), 'data': b64(blob)}


def thumbs(designs):
    """A photo for each design the site doesn't have yet: from the design's "photo" path, else the old shop folder."""
    out = SITE / 'img' / 'designs'
    out.mkdir(parents=True, exist_ok=True)
    for d in designs:
        dst = out / f"{d['slug']}.jpg"
        if dst.exists():
            continue
        src = HERE / d['photo'] if d.get('photo') else OLD_SHOP_PHOTOS / f"{d['slug']}-studio.jpg"
        if not src.exists():
            print(f"no photo for {d['name']}: add \"photo\": \"<image path>\" to it in costs.json")
            continue
        im = Image.open(src).convert('RGB')
        w, h = im.size                                   # centre-crop to 4:5, then shrink
        cw, ch = min(w, h * 4 // 5), min(h, w * 5 // 4)
        im = im.crop(((w - cw) // 2, (h - ch) // 2, (w + cw) // 2, (h + ch) // 2)).resize(THUMB, Image.LANCZOS)
        im.save(dst, quality=82, optimize=True, progressive=True)
        print('photo', dst.relative_to(SITE))


def inline_images(data):
    """CAD drawings go inside the locked data, so they stay private too."""
    for d in data['designs']:
        q = d.get('quote')
        if q and q.get('cad_image') and not q['cad_image'].startswith('data:'):
            q['cad_image'] = 'data:image/png;base64,' + base64.b64encode((HERE / q['cad_image']).read_bytes()).decode()


def main():
    if '--open' in sys.argv or not DATA.exists():
        DATA.write_text(json.dumps(unlock(get_password()), ensure_ascii=False, indent=1))
        print(f'unlocked into {DATA}: edit it, then run python3 tools/publish.py')
        return
    if '--new-password' in sys.argv:
        PASSWORD.write_text(new_password() + '\n')
        print('new password saved in', PASSWORD)
    password = get_password()
    data = json.loads(DATA.read_text())
    thumbs(data['designs'])
    inline_images(data)
    LOCKED.parent.mkdir(parents=True, exist_ok=True)
    LOCKED.write_text(json.dumps(lock(data, password)))
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    print(f"locked {len(data['designs'])} designs -> {LOCKED.relative_to(SITE)} ({LOCKED.stat().st_size // 1024} KB)")


if __name__ == '__main__':
    main()
