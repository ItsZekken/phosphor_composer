import fs from 'fs';
const css = fs.readFileSync('src/index.css', 'utf8');
const lines = css.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('custom-context-menu') || line.includes('action-btn')) {
    console.log(`${idx + 1}: ${line}`);
  }
});
