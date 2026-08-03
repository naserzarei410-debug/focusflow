import fs from 'fs';
import path from 'path';

const iconAliases = {
    'auto_awesome': 'stars',
    'done': 'check',
    'error_outline': 'error',
    'insights': 'analytics',
    'settings_suggest': 'settings',
    'emoji_events': 'trophy',
    'expand_more': 'keyboard_arrow_down'
};

const iconsList = fs.readFileSync('icons_clean.txt', 'utf8').split('\n').filter(Boolean);
const iconsObj = {};

for (let icon of iconsList) {
    icon = icon.trim();
    if (!icon) continue;
    
    let targetSvg = iconAliases[icon] || icon;
    
    const svgPath = path.join('node_modules', '@material-symbols', 'svg-400', 'rounded', `${targetSvg}.svg`);
    if (fs.existsSync(svgPath)) {
        let svg = fs.readFileSync(svgPath, 'utf8');
        iconsObj[icon] = svg;
    } else {
        console.warn(`Warning: Icon ${icon} (target ${targetSvg}) not found at ${svgPath}`);
    }
}

const extraIcons = [
    'menu', 'close', 'arrow_back', 'more_vert', 'search', 'home', 
    'settings', 'dark_mode', 'light_mode', 'auto_stories', 'insights', 
    'tune', 'psychology', 'smart_toy', 'track_changes', 'emoji_events', 
    'check', 'expand_more'
];

for (const icon of extraIcons) {
    if (!iconsObj[icon]) {
        let targetSvg = iconAliases[icon] || icon;
        const svgPath = path.join('node_modules', '@material-symbols', 'svg-400', 'rounded', `${targetSvg}.svg`);
        if (fs.existsSync(svgPath)) {
            iconsObj[icon] = fs.readFileSync(svgPath, 'utf8');
        } else {
            console.warn(`Warning: Extra Icon ${icon} (target ${targetSvg}) not found at ${svgPath}`);
        }
    }
}

const outFile = 'js/core/icons-data.js';
fs.writeFileSync(outFile, `export const ICONS = ${JSON.stringify(iconsObj, null, 2)};\n`);
console.log(`Generated ${outFile} with ${Object.keys(iconsObj).length} icons.`);
