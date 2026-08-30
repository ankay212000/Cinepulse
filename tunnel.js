import localtunnel from 'localtunnel';
import { spawn } from 'child_process';

let activeTunnelInstance = null;
let activeSshProcess = null;

/**
 * Creates an outbound zero-config reverse tunnel for port 3000
 * Tries localtunnel first, with automatic SSH fallback to serveo.net
 * @param {number} port - Local server port (default 3000)
 * @returns {Promise<{ success: boolean, url: string, provider: string }>}
 */
export async function createTunnel(port = 3000) {
  // Close any existing active tunnel session first
  await closeTunnel();

  console.log(`[Tunnel Manager] Creating outbound reverse tunnel for local port ${port}...`);

  // Attempt 1: Try localtunnel npm package with 4s timeout
  try {
    const tunnelPromise = localtunnel({ 
      port,
      subdomain: `cinepulse-room-${Math.random().toString(36).substring(2, 8)}`
    });

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Localtunnel connection timeout')), 4000)
    );

    const tunnel = await Promise.race([tunnelPromise, timeoutPromise]);

    if (tunnel && tunnel.url) {
      activeTunnelInstance = tunnel;
      
      tunnel.on('close', () => {
        console.log('[Tunnel Manager] Localtunnel session closed.');
        activeTunnelInstance = null;
      });

      tunnel.on('error', (err) => {
        console.error('[Tunnel Manager] Localtunnel error:', err.message);
      });

      console.log(`[Tunnel Manager] Successfully connected via Localtunnel: ${tunnel.url}`);
      return {
        success: true,
        url: tunnel.url,
        provider: 'localtunnel'
      };
    }
  } catch (err) {
    console.warn('[Tunnel Manager] Localtunnel connection failed, trying SSH fallback (serveo.net):', err.message);
  }

  // Attempt 2: SSH Fallback to serveo.net (No installation needed, uses built-in OpenSSH)
  return new Promise((resolve) => {
    try {
      const ssh = spawn('ssh', [
        '-tt',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ServerAliveInterval=5',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'ExitOnForwardFailure=yes',
        '-R', `80:localhost:${port}`,
        'serveo.net'
      ]);
      activeSshProcess = ssh;

      let resolved = false;

      ssh.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[Serveo SSH Output]:', output);

        const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.(serveousercontent\.com|serveo\.net)/);
        if (match && !resolved) {
          resolved = true;
          const url = match[0];
          console.log(`[Tunnel Manager] Successfully connected via Serveo SSH: ${url}`);
          resolve({
            success: true,
            url,
            provider: 'serveo.net'
          });
        }
      });

      ssh.stderr.on('data', (data) => {
        console.log('[Serveo SSH Stderr]:', data.toString());
      });

      ssh.on('close', () => {
        console.log('[Tunnel Manager] Serveo SSH process closed.');
        activeSshProcess = null;
      });

      ssh.on('error', (err) => {
        console.error('[Tunnel Manager] Serveo SSH spawn error:', err.message);
        if (!resolved) {
          resolved = true;
          resolve({
            success: false,
            url: `http://localhost:${port}`,
            provider: 'local-fallback'
          });
        }
      });

      // Timeout fallback if Serveo takes > 10 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn('[Tunnel Manager] SSH tunnel creation timed out, falling back to localhost URL');
          resolve({
            success: true,
            url: `http://localhost:${port}`,
            provider: 'localhost'
          });
        }
      }, 10000);

    } catch (e) {
      console.error('[Tunnel Manager] SSH fallback failed:', e.message);
      resolve({
        success: true,
        url: `http://localhost:${port}`,
        provider: 'localhost'
      });
    }
  });
}

/**
 * Safely closes active reverse tunnel connections
 */
export async function closeTunnel() {
  if (activeTunnelInstance) {
    try {
      await activeTunnelInstance.close();
      console.log('[Tunnel Manager] Localtunnel closed.');
    } catch (e) {}
    activeTunnelInstance = null;
  }

  if (activeSshProcess) {
    try {
      activeSshProcess.kill();
      console.log('[Tunnel Manager] Serveo SSH process killed.');
    } catch (e) {}
    activeSshProcess = null;
  }
}
