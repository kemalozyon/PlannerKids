// node --test ile çalışır (npm test). Deno/Vite'a özgü bir şey kullanmaz.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDaysISO, buildFacts, dateLabel, fallbackNarrative, formatMin, genitive, parseNarrative, renderEmail, reportUserPrompt } from './report.ts';
import { sampleInput } from './report.fixtures.ts';

test('genitive: Türkçe tamlayan eki', () => {
  assert.equal(genitive('Ece'), "Ece'nin");
  assert.equal(genitive('Zeynep'), "Zeynep'in");
  assert.equal(genitive('Duru'), "Duru'nun");
  assert.equal(genitive('Aslı'), "Aslı'nın");
  assert.equal(genitive('Ahmet'), "Ahmet'in");
  assert.equal(genitive('Çocuğunuz'), 'Çocuğunuzun');
});

test('tarih yardımcıları', () => {
  assert.equal(dateLabel('2026-10-12'), '12 Ekim Pazartesi');
  assert.equal(addDaysISO('2026-03-01', -1), '2026-02-28');
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01');
  assert.equal(formatMin(0), '0 dk');
  assert.equal(formatMin(45), '45 dk');
  assert.equal(formatMin(120), '2 sa');
  assert.equal(formatMin(85), '1 sa 25 dk');
});

test('buildFacts: dersleri toplar, ortalamayı bugünü hariç tutarak hesaplar', () => {
  const f = buildFacts(sampleInput());
  assert.equal(f.totalMinutes, 85);
  assert.deepEqual(
    f.byCourse.map((c) => [c.course, c.minutes]),
    [
      ['Matematik', 60],
      ['Türkçe', 25],
    ],
  );
  assert.equal(f.weekAverage, 30); // (30+0+60+45+0+45)/6
  assert.equal(f.studiedDaysThisWeek, 5);
  assert.equal(f.mood?.label, 'İyiydi');
  assert.equal(f.tasksDone, 1);
  assert.equal(f.tasksTotal, 2);
  assert.equal(f.readingPages, 12);
  assert.deepEqual(f.plants, ['Çalı']);
  assert.deepEqual(f.notes, ['kesirler']);
});

test('buildFacts: boş gün', () => {
  const f = buildFacts(sampleInput({ studyLogs: [], reflection: null, tasks: [], reading: [], trees: [] }));
  assert.equal(f.totalMinutes, 0);
  assert.equal(f.mood, null);
  assert.equal(f.childNote, null);
  const n = fallbackNarrative(f);
  assert.match(n.summary, /ders çalışması kaydetmedi/);
});

test('parseNarrative: geçerli JSON, çevresindeki metin ve bozuk çıktı', () => {
  const ok = parseNarrative('İşte rapor:\n{"subject":"Ece","summary":"İyi gün","highlights":["a","b","c","d",5],"parent_tip":"Sor"}\nBitti');
  assert.deepEqual(ok, { subject: 'Ece', summary: 'İyi gün', highlights: ['a', 'b', 'c'], parent_tip: 'Sor' });
  assert.equal(parseNarrative('JSON yok'), null);
  assert.equal(parseNarrative('{"subject": 1, "summary": "x"}'), null);
  assert.equal(parseNarrative('{bozuk'), null);
  assert.equal(parseNarrative('{"subject":"s","summary":"x"}')?.highlights.length, 0);
});

test('fallbackNarrative: zor gün için ebeveyne nazik öneri', () => {
  const n = fallbackNarrative(buildFacts(sampleInput({ reflection: { rating: 1, note: null } })));
  assert.match(n.parent_tip, /zor geçtiğini/);
  assert.match(n.subject, /^Ece — 12 Ekim Pazartesi/);
});

test('renderEmail: çocuğun notu ve LLM metni HTML olarak kaçışlanır', () => {
  const f = buildFacts(sampleInput({ reflection: { rating: 3, note: '<script>alert(1)</script>' } }));
  const mail = renderEmail(f, { subject: 'Konu', summary: '<b>özet</b>', highlights: ['<img src=x>'], parent_tip: 'a & b' }, { generatedBy: 'llm' });
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.ok(!mail.html.includes('<b>özet</b>'));
  assert.ok(!mail.html.includes('<img src=x>'));
  assert.ok(mail.html.includes('a &amp; b'));
  assert.match(mail.html, /yapay zekâ yardımıyla/);
  assert.match(mail.text, /Ders çalışması: 1 sa 25 dk/);
});

test('renderEmail: geçersiz ders rengi CSS içine sızmaz', () => {
  const f = buildFacts(sampleInput({ studyLogs: [{ course: 'X', color: 'red;background:url(evil)', minutes: 10 }] }));
  const mail = renderEmail(f, fallbackNarrative(f), { generatedBy: 'fallback' });
  assert.ok(!mail.html.includes('evil'));
  assert.match(mail.html, /otomatik olarak/);
});

test('reportUserPrompt: yalnızca olguları JSON olarak verir', () => {
  const p = reportUserPrompt(buildFacts(sampleInput()));
  const data = JSON.parse(p.slice(p.indexOf('{')));
  assert.equal(data.child_name, 'Ece');
  assert.equal(data.total_study_minutes, 85);
  assert.equal(data.child_note, 'Kesirleri anladım');
});
