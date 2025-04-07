import fs from 'fs';

// Decode base64 PNG to file
let base64 = fs.readFileSync('input-png.base64', 'utf8');

const prefix1 = 'data:image/png;base64,';

if (base64.startsWith(prefix1)) {
  console.log(`Detected and removing prefix: ${prefix1}`);
  base64 = base64.substring(prefix1.length);
} 

const prefix2 = 'data:image/png;';
if (base64.startsWith(prefix2)) {
  console.log(`Detected and removing prefix: ${prefix2}`);
  base64 = base64.substring(prefix2.length);
}

const prefix3 = 'base64,';
if (base64.startsWith(prefix3)) {
  console.log(`Detected and removing prefix: ${prefix3}`);
  base64 = base64.substring(prefix3.length);
}

const buffer = Buffer.from(base64, 'base64');
const outputPath = 'output.png';

try {
  fs.writeFileSync(outputPath, buffer);
  console.log(`Successfully decoded and saved to ${outputPath}`);
} catch (err) {
  console.error('Error writing file:', err);
}

