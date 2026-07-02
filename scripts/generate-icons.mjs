import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

// Hemera brand colors: Marsala background with beige text
const bg = "#884143";
const fg = "#EBE2D3";

function generateIcon(size) {
	const fontSize = Math.round(size * 0.55);
	const cy = Math.round(size * 0.54);
	const radius = Math.round(size * 0.18);

	return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
	  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${bg}"/>
	  <text x="50%" y="${cy}"
	        font-family="Georgia, serif" font-size="${fontSize}" font-weight="bold"
	        fill="${fg}" text-anchor="middle" dominant-baseline="middle">A</text>
	</svg>`);
}

const icons = [
	{ name: "apple-touch-icon.png", size: 180 },
	{ name: "apple-touch-icon-precomposed.png", size: 180 },
	{ name: "favicon-32x32.png", size: 32 },
	{ name: "favicon-16x16.png", size: 16 },
	{ name: "favicon.png", size: 32 },
];

for (const { name, size } of icons) {
	await sharp(generateIcon(size)).png().toFile(path.join(publicDir, name));
	console.log(`Created ${name} (${size}x${size})`);
}

console.log("Done!");
