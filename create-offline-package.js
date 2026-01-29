const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Files needed for offline package
const essentialFiles = [
    'homepage.html',
    'script.js',
    'styles.css',
    'homepage-styles.css',
    'tips.csv',
    'lib-xlsx.js',
    'lib-chart.js',
    'lib-html2canvas.js',
    'lib-jszip.js',
    'README.md'
];

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, 'offline-package');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

// Output file
const output = fs.createWriteStream(path.join(__dirname, 'coaching-tool-offline.zip'));
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
    console.log(`✅ Package created: coaching-tool-offline.zip (${archive.pointer()} bytes)`);
    console.log('📦 Contains all files needed for offline use');
});

archive.on('error', (err) => {
    throw err;
});

archive.pipe(output);

// Add essential files
essentialFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`Adding: ${file}`);
        archive.file(file, { name: file });
    } else {
        console.log(`⚠️  Skipping missing: ${file}`);
    }
});

// Update index.html to use local libraries
const indexContent = fs.readFileSync('index.html', 'utf8');
const offlineIndex = indexContent
    .replace('https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js', 'lib-xlsx.js')
    .replace('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js', 'lib-chart.js')
    .replace('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'lib-html2canvas.js')
    .replace('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'lib-jszip.js');

archive.append(offlineIndex, { name: 'index.html' });
console.log('Adding: index.html (with local library references)');

// Add README for offline package
const offlineReadme = `# Development Coaching Tool - Offline Package

This package contains everything you need to run the Development Coaching Tool offline.

## How to Use:

1. Extract this ZIP file to a folder on your computer
2. Open \`index.html\` in your web browser
3. The tool will work completely offline - no internet required!

## What's Included:

- Main application files (index.html, script.js, styles.css)
- All JavaScript libraries (Chart.js, SheetJS, html2canvas)
- Tips database (tips.csv)
- Homepage and styling files

## System Requirements:

- Any modern web browser (Chrome, Firefox, Edge, Safari)
- No internet connection required after extraction
- No installation needed - just open index.html

Created: ${new Date().toLocaleDateString()}
`;

archive.append(offlineReadme, { name: 'OFFLINE-README.txt' });

archive.finalize();
