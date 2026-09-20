import assert from "node:assert/strict";
import test from "node:test";
import { buildFourChoiceFilter, fourChoiceLayout, normalizeChoiceImages, workerTopicImagePath } from "./psychology-four-image.js";
import { hasCompleteFourImages, normalizeTopic, parseFourImageChoices, serializeFourImageChoices } from "./psychology-topic-bank.js";

test("parses uploaded JSON and grokbot A/B/C/D url lines", () => {
  const fromJson = parseFourImageChoices(serializeFourImageChoices([
    {label:"A",copy:"Moon",imageKey:"psychology-topics/11111111-1111-4111-8111-111111111111.jpg"},
    {label:"B",copy:"Flame",imageUrl:"https://images.unsplash.com/photo-1"},
    {label:"C",copy:"River",imageUrl:"https://images.unsplash.com/photo-2"},
    {label:"D",copy:"Forest",imageUrl:"https://images.unsplash.com/photo-3"},
  ]));
  assert.equal(fromJson[0].imageKey.endsWith(".jpg"), true);
  assert.equal(fromJson[1].copy, "Flame");
  const fromText = parseFourImageChoices([
    "A: Moon | https://images.unsplash.com/photo-1532693",
    "B: Flame | https://images.unsplash.com/photo-14969312",
    "C: River | https://images.unsplash.com/photo-15005308",
    "D: Forest | https://images.unsplash.com/photo-14419741",
  ].join("\n"));
  assert.equal(fromText[0].copy, "Moon");
  assert.match(fromText[3].imageUrl, /unsplash/);
  assert.equal(parseFourImageChoices("just a script"), null);
});

test("psychology topics require four copies and images when choices are sent", () => {
  assert.throws(() => normalizeTopic({title:"Q",choices:[{copy:"A"}]},"psychology"), /四个选项/);
  const topic = normalizeTopic({
    title:"Which symbol?",
    choices:["A","B","C","D"].map((label,index)=>({copy:label+" copy",imageUrl:"https://images.unsplash.com/photo-"+index})),
  },"psychology");
  assert.equal(hasCompleteFourImages(topic.choices), true);
  assert.match(topic.content, /"choices"/);
});

test("four-image layout and worker asset path stay stable", () => {
  const portrait = fourChoiceLayout("9:16");
  assert.equal(portrait.width, 1080);
  assert.equal(portrait.cols, 2);
  assert.equal(portrait.rows, 2);
  const landscape = fourChoiceLayout("16:9");
  assert.equal(landscape.cols, 4);
  const filter = buildFourChoiceFilter({
    layout: portrait,
    fontFile: "C:/Windows/Fonts/msyh.ttc",
    copyFiles: ["a.txt","b.txt","c.txt","d.txt"],
  });
  assert.match(filter, /\[1:v\]scale=540:/);
  assert.match(filter, /text='A'/);
  assert.match(filter, /\[final\]$/);
  const choices = normalizeChoiceImages([
    {copy:"Moon",imageKey:"psychology-topics/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg"},
    {copy:"Flame",imageUrl:"https://images.unsplash.com/photo-1"},
    {copy:"River",dataUrl:"data:image/jpeg;base64,/9j/2Q=="},
    {copy:"Forest",imagePath:"C:/tmp/d.jpg"},
  ]);
  assert.equal(hasCompleteFourImages(choices), true);
  assert.equal(workerTopicImagePath(choices[0]), "/api/worker/psychology-topic-images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg");
});
