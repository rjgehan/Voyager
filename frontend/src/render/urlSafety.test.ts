import { describe, expect, it } from 'vitest';
import { cssLoadsRemote, decodeCss, isRemoteUrl, removeRemoteLoads, safeInlineStyle, svgAttributeLoads } from './urlSafety';

const BASE = 'https://notes.example.ts.net/n/Note.md';

describe('isRemoteUrl (security audit)', () => {
  it('resolves URLs as the browser does, whatever their spelling', () => {
    for (const remote of ['https://e.example/p', '//e.example/p', 'https:\\\\e.example\\p', '/\\e.example/p', '\\\\e.example/p', ' HTTPS://e.example', 'http://notes.example.ts.net/x', 'javascript:alert(1)', 'about:blank', 'http://[::1', 'ftp://e.example/x']) {
      expect(isRemoteUrl(remote, BASE), remote).toBe(true);
    }
    for (const local of ['', '  ', 'Attachments/a.png', '/api/files/raw?path=a.png', '#frag', '?q=1', 'data:image/png;base64,iVBORw0KGgo=', 'https://notes.example.ts.net/api/x']) {
      expect(isRemoteUrl(local, BASE), local).toBe(false);
    }
  });
});

describe('CSS checks (security audit)', () => {
  it('finds every CSS function that loads, escapes and comments read as the browser reads them', () => {
    expect(cssLoadsRemote('background:url(https://e.example/x.png)')).toBe(true);
    expect(cssLoadsRemote('background-image: image-set("https://e.example/x.png" 1x)')).toBe(true);
    expect(cssLoadsRemote('mask: -webkit-cross-fade(a, b, 50%)')).toBe(true);
    expect(cssLoadsRemote('fill:url(#grad)')).toBe(false);
    expect(cssLoadsRemote('background:url("data:image/png;base64,iVBOR")')).toBe(false);
    expect(cssLoadsRemote('color: red')).toBe(false);
    expect(decodeCss('u\\72 l(https://e.example) p\\osition /* x */ :fixed')).toBe('url(https://e.example) position  :fixed');
    expect(cssLoadsRemote(decodeCss('background:u\\72 l(https://e.example/p)'))).toBe(true);
  });

  it('keeps ordinary declarations and drops what could draw over the app or hide from the checks', () => {
    expect(safeInlineStyle('color: red; position: relative; top: 2px', false)).toBe('color: red;position: relative;top: 2px');
    for (const overlay of [
      'position:fixed',
      'POSITION : FIXED',
      'position: -webkit-sticky',
      '/**/position:fixed',
      'p\\osition:fixed',
      'position\\3a fixed',
      '--p:fixed',
      'position:var(--p)',
      'position: attr(data-p type(<custom-ident>))',
      'position: if(media(width > 0): fixed; else: static)',
      'z-index:2147483647',
      '/**/z-index:9',
      'z-ind\\ex:9',
      'color: red /* ; position: fixed */',
    ]) {
      expect(safeInlineStyle(overlay, false), overlay).not.toMatch(/fixed|sticky|z-ind|var\(|attr\(|\\|\/\*/i);
    }
    expect(safeInlineStyle('--p:fixed;position:var(--p);inset:0;/**/z-index:2147483647;background:#fff', false)).toBe('inset:0;background:#fff');
  });

  it('with remote loading off, drops declarations that load from the network, spelled any way', () => {
    expect(safeInlineStyle('background:url(https://e.example/bg.png); color: red', true)).toBe('color: red');
    expect(safeInlineStyle('background:u\\rl(https://e.example/bg.png); color: red', true)).toBe('color: red');
    expect(safeInlineStyle('background-image:image-set("https://e.example/a.png" 1x)', true)).toBe('');
    expect(safeInlineStyle('cursor:url(https://e.example/c.cur), auto', true)).toBe('');
    expect(safeInlineStyle('fill:url(#grad)', true)).toBe('fill:url(#grad)');
    expect(safeInlineStyle('background:url(https://e.example/bg.png)', false)).toBe('background:url(https://e.example/bg.png)');
  });
});

describe('removeRemoteLoads (security audit)', () => {
  it('removes every attribute that loads from another site, and keeps links and local references', () => {
    const div = document.createElement('div');
    div.innerHTML =
      '<img src="Attachments/a.png" srcset=",https://e.example/p 2x">' +
      '<video src="https:\\\\e.example\\v.mp4" poster="/\\e.example/p.png"></video>' +
      '<audio><source src="//e.example/a.mp3"></audio>' +
      '<table background="https://e.example/t.png"><tr><td background="/\\e.example/td.png">x</td></tr></table>' +
      '<a href="https://e.example/page">link</a>' +
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="/\\e.example/i.png"></image><use href="https://e.example/s.svg#a"></use>' +
      '<rect id="r1" fill="url(https://e.example/s.svg#p)"></rect><rect id="r2" fill="url(#grad)" filter="u\\72l(https://e.example/f.svg#f)"></rect>' +
      '<a href="https://e.example/svg-link"><text aria-label="C:\\temp">t</text></a></svg>';
    removeRemoteLoads(div);
    expect(div.querySelector('img')!.getAttribute('src')).toBe('Attachments/a.png');
    expect(div.querySelector('img')!.hasAttribute('srcset')).toBe(false);
    expect(div.querySelector('video')!.hasAttribute('src')).toBe(false);
    expect(div.querySelector('video')!.hasAttribute('poster')).toBe(false);
    expect(div.querySelector('source')!.hasAttribute('src')).toBe(false);
    expect(div.querySelector('table')!.hasAttribute('background')).toBe(false);
    expect(div.querySelector('td')!.hasAttribute('background')).toBe(false);
    expect(div.querySelector('a')!.getAttribute('href')).toBe('https://e.example/page');
    expect(div.querySelector('image')!.hasAttribute('href')).toBe(false);
    expect(div.querySelector('use')!.hasAttribute('href')).toBe(false);
    expect(div.querySelector('#r1')!.hasAttribute('fill')).toBe(false);
    expect(div.querySelector('#r2')!.getAttribute('fill')).toBe('url(#grad)');
    expect(div.querySelector('#r2')!.hasAttribute('filter')).toBe(false);
    expect(div.querySelector('svg a')!.getAttribute('href')).toBe('https://e.example/svg-link');
    expect(div.querySelector('text')!.getAttribute('aria-label')).toBe('C:\\temp');
  });

  it('treats only presentation attributes of SVG as CSS', () => {
    expect(svgAttributeLoads('fill', 'url(https://e.example/x#p)')).toBe(true);
    expect(svgAttributeLoads('mask', 'u\\rl(https://e.example/m#m)')).toBe(true);
    expect(svgAttributeLoads('fill', 'url(#p)')).toBe(false);
    expect(svgAttributeLoads('aria-label', 'url(https://e.example)')).toBe(false);
    expect(svgAttributeLoads('href', 'https://e.example')).toBe(false);
  });
});
