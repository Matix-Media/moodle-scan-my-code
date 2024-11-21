print("PRC: Starting...")

import sys
from io import BytesIO

import requests
from PIL import Image
from pyzbar.pyzbar import decode

img_url = sys.argv[1]

if img_url is None:
    print("Usage: python reader.py <image_url>", file=sys.stderr)
    sys.exit(1)

# Download image into memory from URL
print("PRC: Downloading image from URL...")
response = requests.get(img_url)
print("PRC: Reading image...")
img = Image.open(BytesIO(response.content))

print("PRC: Decoding QR code...")

# Decode QR code
result = decode(img)

for symbol in result:
    print("RES:", symbol.data.decode("utf-8"))