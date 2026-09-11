const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWebsite,
  normalizeInstagram,
  instagramProfileUrl,
  normalizeLeadLinks,
  normalizePhoneDisplay,
} = require('../utils/lead-links');

test('link do Google nunca vira site da empresa', () => {
  assert.equal(normalizeWebsite('https://maps.app.goo.gl/abc123'), '');
  assert.equal(normalizeWebsite('https://www.google.com/maps/place/Odonto'), '');
  assert.equal(normalizeWebsite('https://lh3.googleusercontent.com/p/AF1QipXYZ'), '');
  assert.equal(normalizeWebsite('https://g.co/kgs/xyz'), '');
  assert.equal(normalizeWebsite('https://goo.gl/maps/abc'), '');
  assert.equal(normalizeWebsite('http://localhost:3000/admin'), '');
  assert.equal(normalizeWebsite('javascript:alert(1)'), '');
});

test('site próprio é mantido e perde parâmetros de campanha', () => {
  assert.equal(normalizeWebsite('clinica.example'), 'https://clinica.example/');
  assert.equal(normalizeWebsite('https://www.clinica.example/contato?utm_source=gmaps#topo'), 'https://www.clinica.example/contato');
  assert.equal(normalizeWebsite('odonto-lume.com.br'), 'https://odonto-lume.com.br/');
});

test('link do Google que embrulha o site real é desembrulhado', () => {
  assert.equal(
    normalizeWebsite('https://www.google.com/url?q=https://clinica.example/contato&sa=D&usg=abc'),
    'https://clinica.example/contato',
  );
});

test('Instagram vira @handle em qualquer formato', () => {
  assert.equal(normalizeInstagram('https://www.instagram.com/odonto.lume/?igsh=abc'), '@odonto.lume');
  assert.equal(normalizeInstagram('https://instagram.com/odonto.lume/'), '@odonto.lume');
  assert.equal(normalizeInstagram('instagram.com/odonto.lume'), '@odonto.lume');
  assert.equal(normalizeInstagram('@odonto.lume'), '@odonto.lume');
  assert.equal(normalizeInstagram('odonto.lume'), '@odonto.lume');
  assert.equal(normalizeInstagram('https://www.instagram.com/p/CxYz123/'), '');
  assert.equal(normalizeInstagram('https://www.instagram.com/stories/odonto.lume/'), '');
  assert.equal(normalizeInstagram('clinica.com'), '');
  assert.equal(normalizeInstagram(''), '');
});

test('url pública do perfil é montada a partir do handle', () => {
  assert.equal(instagramProfileUrl('https://instagram.com/odonto.lume/'), 'https://instagram.com/odonto.lume');
  assert.equal(instagramProfileUrl('@odonto.lume'), 'https://instagram.com/odonto.lume');
  assert.equal(instagramProfileUrl(''), '');
});

test('site que na verdade é Instagram migra para o campo certo', () => {
  const instagramOnly = normalizeLeadLinks({ website: 'https://instagram.com/cafe.aurora', instagram: '' });
  assert.equal(instagramOnly.website, '');
  assert.equal(instagramOnly.instagram, '@cafe.aurora');

  const both = normalizeLeadLinks({
    website: 'https://cafeaurora.com?fbclid=123',
    instagram: 'https://instagram.com/cafe.aurora/',
  });
  assert.equal(both.website, 'https://cafeaurora.com/');
  assert.equal(both.instagram, '@cafe.aurora');
});

test('telefone perde glifos invisíveis do Maps', () => {
  assert.equal(normalizePhoneDisplay('\uE0B0 (21) 98765-0142'), '(21) 98765-0142');
  assert.equal(normalizePhoneDisplay('+55 21 98765-0142'), '+55 21 98765-0142');
  assert.equal(normalizePhoneDisplay('123'), '');
});
