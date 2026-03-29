"""Generate PWA icons for Neuro Mines using Pillow."""
from PIL import Image, ImageDraw, ImageFont
import math, os

def generate_icon(size, path):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size  # shorthand
    
    # Background with rounded corners (approximate with filled rectangle + circles)
    r = s // 6  # corner radius
    bg = '#0D1117'
    # Full background
    d.rounded_rectangle([0, 0, s-1, s-1], radius=r, fill=bg)
    
    # Inner board area
    m = s // 9  # margin
    board_r = s // 12
    d.rounded_rectangle([m, m, s-m-1, s-m-1], radius=board_r, fill='#161B22', outline='#30363D', width=max(1, s//128))
    
    # Grid lines
    grid_color = '#30363D'
    lw = max(1, s // 256)
    cell_w = (s - 2*m) / 4
    for i in range(1, 4):
        x = int(m + i * cell_w)
        d.line([(x, m), (x, s-m)], fill=grid_color, width=lw)
        y = int(m + i * cell_w)
        d.line([(m, y), (s-m, y)], fill=grid_color, width=lw)
    
    # Mine circle (cell 2,2 - bottom right area)
    cx = int(m + 2.5 * cell_w)
    cy = int(m + 2.5 * cell_w)
    mine_r = int(cell_w * 0.32)
    d.ellipse([cx-mine_r, cy-mine_r, cx+mine_r, cy+mine_r], fill='#F85149')
    
    # Mine spikes
    spike_len = int(mine_r * 0.45)
    spike_w = max(1, s // 85)
    for angle in [0, 90, 180, 270]:
        rad = math.radians(angle)
        x1 = cx + int(math.cos(rad) * mine_r)
        y1 = cy + int(math.sin(rad) * mine_r)
        x2 = cx + int(math.cos(rad) * (mine_r + spike_len))
        y2 = cy + int(math.sin(rad) * (mine_r + spike_len))
        d.line([(x1, y1), (x2, y2)], fill='#F85149', width=spike_w)
    
    # Numbers - try to use a bold font
    try:
        font_size = int(cell_w * 0.7)
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        font = ImageFont.load_default()
    
    # "1" in top-center cell (1,0) - blue
    tx = int(m + 1.5 * cell_w)
    ty = int(m + 0.5 * cell_w)
    d.text((tx, ty), "1", fill='#58A6FF', font=font, anchor='mm')
    
    # "3" in left-center cell (0,1) - red  
    tx = int(m + 0.5 * cell_w)
    ty = int(m + 1.5 * cell_w)
    d.text((tx, ty), "3", fill='#F85149', font=font, anchor='mm')
    
    # "2" top-right (2,0) - green
    tx = int(m + 2.5 * cell_w)
    ty = int(m + 0.5 * cell_w)
    d.text((tx, ty), "2", fill='#3FB950', font=font, anchor='mm')
    
    # Flag in cell (0,2)
    fx = int(m + 0.5 * cell_w)
    fy = int(m + 2.5 * cell_w)
    flag_h = int(cell_w * 0.5)
    pole_w = max(1, s // 128)
    # pole
    d.line([(fx, fy - flag_h//2), (fx, fy + flag_h//2)], fill='#C9D1D9', width=pole_w)
    # flag triangle
    flag_size = int(flag_h * 0.5)
    d.polygon([
        (fx + 2, fy - flag_h//2),
        (fx + flag_size, fy - flag_h//2 + flag_size//2),
        (fx + 2, fy - flag_h//2 + flag_size)
    ], fill='#F0C040')
    
    # Sparkle dots (top-right area)
    sparkle_r = max(2, s // 64)
    d.ellipse([s - m - cell_w//2 - sparkle_r, m + cell_w//4 - sparkle_r,
               s - m - cell_w//2 + sparkle_r, m + cell_w//4 + sparkle_r], fill='#F0C040')
    
    # Unopened cells (darker) - cells (1,1), (3,0), (3,1) etc.
    unopened = [(1,1), (3,0), (3,1), (0,3), (1,3), (2,3), (3,3), (3,2), (1,2), (0,0)]
    for gx, gy in unopened:
        cx1 = int(m + gx * cell_w) + 2
        cy1 = int(m + gy * cell_w) + 2
        cx2 = int(m + (gx+1) * cell_w) - 2
        cy2 = int(m + (gy+1) * cell_w) - 2
        d.rounded_rectangle([cx1, cy1, cx2, cy2], radius=max(2, s//80), fill='#21262D')
    
    img.save(path, 'PNG')
    print(f'  Generated {path} ({size}x{size})')

out_dir = r'd:\WorkSpace\weChatCode\ScanBoomBoom\icons'
for size in [192, 512]:
    generate_icon(size, os.path.join(out_dir, f'icon-{size}.png'))

print('Done!')
