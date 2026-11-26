import { STATE } from './config.js';
import { particleSystem } from './particle.js';

let lastForm;
let lastWord;
let lastPhoto;

export function nextPhotoTarget() {
    const frames = particleSystem.filter((p) => p.type === 'PHOTO').map((p) => p.mesh);
    if (!frames.length) return null;
    lastPhoto = frames[(frames.indexOf(lastPhoto) + 1) % frames.length];
    return lastPhoto;
}

export function focusPhoto() {
    return focus(nextPhotoTarget());
}

export function focusNushu() {
    const byForm = new Map();
    for (const particle of particleSystem) {
        if (particle.type !== 'NUSHU') continue;
        const form = particle.instanced.mesh.geometry.userData.form;
        if (!byForm.has(form)) byForm.set(form, new Map());
        const byWord = byForm.get(form);
        if (!byWord.has(particle.mesh.name)) byWord.set(particle.mesh.name, []);
        byWord.get(particle.mesh.name).push(particle.mesh);
    }
    const options = [...byForm.keys()];
    if (!options.length) return false;
    const otherForms = options.filter((form) => form !== lastForm);
    const form = choose(otherForms.length ? otherForms : options);
    const byWord = byForm.get(form);
    const words = [...byWord.keys()];
    const otherWords = words.filter((word) => word !== lastWord);
    const word = choose(otherWords.length ? otherWords : words);
    lastForm = form;
    lastWord = word;
    return focus(choose(byWord.get(word)));
}

function focus(mesh) {
    if (!mesh) return false;
    STATE.mode = 'FOCUS';
    STATE.focusTarget = mesh;
    STATE.focusRotation.yaw = 0;
    STATE.focusRotation.pitch = 0;
    return true;
}

function choose(items) {
    return items[Math.floor(Math.random() * items.length)];
}
