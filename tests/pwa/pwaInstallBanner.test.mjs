import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('PWA Manifest Configuration', () => {
  test('manifest.ts specifies start_url as /dashboard for direct app entry', () => {
    const manifestSource = fs.readFileSync(path.join(REPO_ROOT, 'src/app/manifest.ts'), 'utf8');
    assert.ok(manifestSource.includes('start_url: "/dashboard"'), 'PWA start_url must be /dashboard');
  });

  test('manifest.ts specifies display as standalone', () => {
    const manifestSource = fs.readFileSync(path.join(REPO_ROOT, 'src/app/manifest.ts'), 'utf8');
    assert.ok(manifestSource.includes('display: "standalone"'), 'PWA display mode must be standalone');
  });

  test('manifest.ts pins app identity id as /', () => {
    const manifestSource = fs.readFileSync(path.join(REPO_ROOT, 'src/app/manifest.ts'), 'utf8');
    assert.ok(manifestSource.includes('id: "/"'), 'PWA id must remain / for seamless updates');
  });

  test('manifest.ts configures brand theme color #253b8e', () => {
    const manifestSource = fs.readFileSync(path.join(REPO_ROOT, 'src/app/manifest.ts'), 'utf8');
    assert.ok(manifestSource.includes('theme_color: "#253b8e"'), 'Theme color must match PEWOSA navy');
  });

  test('manifest.ts configures 192, 512, and maskable icon references', () => {
    const manifestSource = fs.readFileSync(path.join(REPO_ROOT, 'src/app/manifest.ts'), 'utf8');
    assert.ok(manifestSource.includes('/icons/icon-192.png'), 'Must reference icon-192');
    assert.ok(manifestSource.includes('/icons/icon-512.png'), 'Must reference icon-512');
    assert.ok(manifestSource.includes('purpose: "maskable"'), 'Must include maskable icon purpose');
  });
});

describe('PWA Layout Metadata & Viewport', () => {
  test('siteMetadata.ts configures viewportFit as cover for notched devices', () => {
    const metadataSource = fs.readFileSync(path.join(REPO_ROOT, 'src/utils/siteMetadata.ts'), 'utf8');
    assert.ok(metadataSource.includes('viewportFit: "cover"'), 'viewportFit must be cover');
    assert.ok(metadataSource.includes('themeColor: "#253b8e"'), 'themeColor must match brand');
  });

  test('siteMetadata.ts links manifest.webmanifest and appleWebApp settings', () => {
    const metadataSource = fs.readFileSync(path.join(REPO_ROOT, 'src/utils/siteMetadata.ts'), 'utf8');
    assert.ok(metadataSource.includes('manifest: "/manifest.webmanifest"'), 'Metadata must link manifest');
    assert.ok(metadataSource.includes('capable: true'), 'appleWebApp must be capable');
  });
});
