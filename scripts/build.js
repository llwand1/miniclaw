const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const ts = require('typescript');

const rootDir = path.resolve(__dirname, '..');

// Step 1: Build React frontend (office-web)
console.log('[build] Building React frontend (office-web)...');
const webDir = path.join(rootDir, 'src', 'office-web');
const viteBin = path.join(webDir, 'node_modules', '.bin', 'vite');
if (fs.existsSync(path.join(webDir, 'node_modules'))) {
  execSync(`npm run build`, { cwd: webDir, stdio: 'inherit', shell: true });
} else {
  console.log('[build] Skipping web build - dependencies not installed. Run npm install in src/office-web/ first.');
}

// Step 2: Compile TypeScript
console.log('[build] Compiling TypeScript...');
const configPath = path.join(rootDir, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir);
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const result = program.emit();

const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(result.diagnostics);
if (allDiagnostics.length > 0) {
  allDiagnostics.forEach(d => {
    if (d.file && d.start != null) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      console.error(`${d.file.fileName}(${line + 1},${character + 1}): ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    } else {
      console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    }
  });
  process.exit(1);
}

console.log('[build] Build complete!');
