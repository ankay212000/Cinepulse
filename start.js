import { exec } from 'child_process';
import os from 'os';

console.log('===================================================');
console.log(' Starting CinePulse Server...');
console.log('===================================================');

const openBrowser = () => {
  const url = 'http://localhost:3000';
  const platform = os.platform();
  if (platform === 'win32') {
    exec(`start ${url}`);
  } else if (platform === 'darwin') {
    exec(`open ${url}`);
  } else {
    exec(`xdg-open ${url}`);
  }
};

setTimeout(openBrowser, 1500);

import('./server.js');
