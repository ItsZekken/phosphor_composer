import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { exec } from 'child_process'

const processPatternsPlugin = () => ({
  name: 'process-patterns-plugin',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.url === '/api/process-patterns') {
        exec('node scripts/processPatterns.mjs', (error, stdout, stderr) => {
          if (error) {
            console.error(`Error running processPatterns.mjs: ${error.message}`);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: error.message }));
            return;
          }
          console.log(`processPatterns.mjs output: ${stdout}`);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, stdout }));
        });
      } else {
        next();
      }
    });
  }
})

// https://vite.dev/config/
export default defineConfig({
  base: '/phosphor_composer/',
  plugins: [react(), processPatternsPlugin()],
})

