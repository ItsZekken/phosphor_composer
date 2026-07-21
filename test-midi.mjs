import pkg from '@tonejs/midi';
const { Midi } = pkg;
const m = new Midi();
m.name = "My Song";
m.header.meta.push({
  text: "SOME_METADATA_JSON",
  type: "text",
  ticks: 0
});
const t = m.addTrack();
t.name = "Track 1";
t.addNote({ midi: 60, time: 0, duration: 1 });

const serialized = m.toArray();
const m2 = new Midi(serialized);
console.log('Deserialized header name:', m2.name);
console.log('Deserialized header meta:', m2.header.meta);
