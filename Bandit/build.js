const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const SRC_DIR = path.join(__dirname, 'src');
const TEMPLATE_HTML = path.join(SRC_DIR, 'ui', 'template.html');
const TEMPLATE_CSS = path.join(SRC_DIR, 'ui', 'template.css');

// Plugin to inject the HTML and CSS templates directly into content.js
const templateInjectorPlugin = {
  name: 'template-injector',
  setup(build) {
    build.onLoad({ filter: /content\.js$/ }, async (args) => {
      let source = await fs.promises.readFile(args.path, 'utf8');
      
      const html = await fs.promises.readFile(TEMPLATE_HTML, 'utf8');
      const css = await fs.promises.readFile(TEMPLATE_CSS, 'utf8');
      
      // Escape backticks and dollars for template literals
      const escape = (str) => str.replace(/`/g, '\\`').replace(/\$/g, '\\$');
      
      source = source.replace(/`__TEMPLATE_HTML__`/g, '`' + escape(html) + '`');
      source = source.replace(/`__TEMPLATE_CSS__`/g, '`' + escape(css) + '`');
      
      return {
        contents: source,
        loader: 'js'
      };
    });
  }
};

async function buildPlatform(platform) {
  const distDir = path.join(__dirname, 'dist', platform);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  console.log(`Building for ${platform}...`);
  
  // Build JS
  await esbuild.build({
    entryPoints: ['src/content.js'],
    bundle: true,
    outfile: path.join(distDir, 'content.bundle.js'),
    format: 'iife',
    target: 'es2020',
    minify: false,
    plugins: [templateInjectorPlugin]
  });
  
  await esbuild.build({
    entryPoints: ['src/background.js'],
    bundle: true,
    outfile: path.join(distDir, 'background.bundle.js'),
    format: 'iife',
    target: 'es2020',
    minify: false
  });

  await esbuild.build({
    entryPoints: ['src/popup.js'],
    bundle: true,
    outfile: path.join(distDir, 'popup.js'),
    format: 'iife',
    target: 'es2020',
    minify: false
  });

  // Process manifest.json
  const manifestRaw = await fs.promises.readFile(path.join(SRC_DIR, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);

  if (platform === 'chrome') {
    // Chrome requires service_worker for MV3 background
    manifest.background = { service_worker: "background.bundle.js" };
    // Chrome warns about browser_specific_settings, so remove it
    delete manifest.browser_specific_settings;
  } else if (platform === 'firefox') {
    // Firefox requires scripts for MV3 background
    manifest.background = { scripts: ["background.bundle.js"] };
  }

  await fs.promises.writeFile(
    path.join(distDir, 'manifest.json'), 
    JSON.stringify(manifest, null, 2)
  );

  // Copy static assets
  await fs.promises.copyFile(
    path.join(__dirname, 'index.html'), 
    path.join(distDir, 'index.html')
  );
  await fs.promises.copyFile(
    path.join(SRC_DIR, 'popup.html'), 
    path.join(distDir, 'popup.html')
  );
}

async function build() {
  try {
    await buildPlatform('firefox');
    await buildPlatform('chrome');
    console.log('Build complete! Generated dist/firefox and dist/chrome');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

build();
