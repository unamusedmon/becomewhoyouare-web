# Become Who You Are (for the Web)

### *or, Zarathustra Gets a Laptop*

> *"You shall become the person you are."*
> (*The Gay Science* §270, now also available in a browser tab, between forty-one other browser tabs)

The desktop edition of [Become Who You Are](https://github.com/unamusedmon/becomewhoyouare), a task app for ADHD brains with a Nietzschean spine. Same hammer, bigger screen. It runs in your browser, lives on your own computer, and keeps in step with the Android app through a WebDAV folder you already own.

---

## Prologue: Zarathustra Sits Down at a Desk

After ten years in the mountains and one week with the phone app, Zarathustra noticed something. His becomings were on his phone. His work was on his laptop. Every morning he stood between them like a man between two lovers who refuse to meet.

And Zarathustra spoke thus: *"Must the bridge always be someone else's cloud? Must I hand my dentist appointment to a company in order to see it twice?"*

So he pointed both at a folder he owned, and they began to speak. This repository is the laptop half.

---

## Book One: Of the Two Bodies (what this is)

**§1. A sibling, not a twin.** The Android app lives in [`unamusedmon/becomewhoyouare`](https://github.com/unamusedmon/becomewhoyouare). This is its own app, in its own repo, with its own README (this one). It started as the phone app's code exported to the web and then left home, as all good children do.

**§2. Same soul.** Everything that makes the app what it is comes along: the smallest first step, energy instead of virtue, time you can feel, implementation intentions, the eternal recurrence as a triage question, self-overcoming measured honestly, and no red anywhere. The philosophy and the science are written up in the phone repo's [`docs/design/`](https://github.com/unamusedmon/becomewhoyouare/tree/main/docs/design). Read those. They are better than this paragraph.

**§3. What stayed on the phone.** Nudges (local notifications), the Android "Quick add" icon shortcut and haptics are native things, so they live only in the Android app. The mic button still works in browsers that offer speech recognition (in Chrome, that audio goes to Google's speech service; where a browser can't listen, the mic just puts you back in the text field).

**§4. Where your data lives.** In your browser's storage on this computer. Nothing leaves it unless you turn on sync, and then it goes only to the WebDAV folder you name. You are a free spirit and so is your data, now in two places.

---

## Book Two: Of the Afterworldly (how to run it)

Behold, mortal. You need Node 20 or newer.

```bash
npm install
npm run build       # writes dist/ (once, and again after pulling changes)
npm run serve       # then open http://localhost:8787
```

While working on the code:

```bash
npm start           # Expo's dev server, web only, with live reload
npm test            # the domain tests, which prove things rather than merely believe them
npm run typecheck   # TypeScript: the categorical imperative, but for types
```

`npm start` is for changing the app. For using it (and for sync), use `build` + `serve`: only `serve` has the WebDAV relay described below.

`serve` takes a few settings from the environment: `PORT` (8787), `HOST` (127.0.0.1), `DIST` (./dist) and `DAV_ALLOW`.

---

## Book Three: Of the Bridge Between Worlds (sync)

**WebDAV.** Use any WebDAV folder you already have: Nextcloud, ownCloud, Fastmail files, `rclone serve webdav`, Apache, a gnome in a shed running Apache. In Settings (the link at the bottom of Becoming), fill in the folder URL, your username and an app password, then do the same on the phone with the same folder. Each device reads and merges the other's changes on start, when you come back to the app, every few minutes, and about 15 seconds after you change something.

The file is `become-who-you-are.json`. Whatever was changed most recently wins, per task, routine and becoming. History is never lost, because events are merged, never replaced. The password stays on the device it was typed into and is never synced.

**Why `serve` exists at all.** Browsers refuse to talk to a server on another origin unless that server says yes (CORS), and most WebDAV servers say nothing. So the page sends its WebDAV requests to `/__dav` on its own origin, and `scripts/serve-web.mjs` forwards them. It listens on 127.0.0.1 only, and every relay request must carry a header other websites can't send without asking first, which this server never approves. Set `DAV_ALLOW=cloud.example.com` to limit where it may forward. The phone app needs none of this; it talks to the server directly.

If you host the built `dist/` somewhere else, sync only works if your WebDAV server sends CORS headers for that origin. The relay is the easy road. Zarathustra took the easy road and felt no shame.

---

## Book Four: Of the Scroll of Emacs (Org-mode)

Off until you turn it on (Settings, needs sync). Then the app also writes `become-who-you-are.org` beside the data file, with sections for Becoming, Tasks, Routines, Set aside and Done (finished and let-go tasks stay for 14 days). In Emacs or Orgzly you can:

- change a keyword: `TODO` open, `NEXT` started, `WAITING` set aside, `DONE`, `CANCELLED` let go
- retitle a heading or rewrite its `FIRST_STEP` property
- add a heading under Tasks, Becoming or Routines (`:CADENCE: daily` and friends for routines)

The next sync on a device with Org turned on picks those up. Deleting a heading does nothing (mark it `CANCELLED`), and a `DONE` can't become `TODO` again from Org, because what is done is done, and Nietzsche would have wanted you to affirm it. The `#+BWYA_SYNCED` line says which sync wrote the file; edits to an older copy are ignored so they can never undo newer work, so keep the file open in Emacs with auto-revert on.

---

## Book Five: Of Masks (encryption)

*"Everything profound loves the mask."* (*Beyond Good and Evil* §40)

**Encryption** (Settings, needs sync) seals the sync file with a passphrase before it leaves the browser: scrypt stretches the passphrase into a key and AES-256-GCM encrypts the data, so the WebDAV server holds only scrambled bytes. Enter the same passphrase on every device, phone included. Entering a new one on a device that already has the current one changes it, and the others ask for the new one. The passphrase itself is never stored, only the key made from it. Lose it and your devices still have everything; "replace the server's copy" starts over with a new passphrase from one device. There is no switching encryption back off yet.

With encryption on, a plaintext Org file would give the game away, so Org is written only as `become-who-you-are.org.gpg`, encrypted to a **GPG key you import** (paste `gpg --armor --export-secret-keys KEYID`, plus its passphrase). Its first line sets `epa-file-encrypt-to`, so Emacs (EasyPG) opens it with your own keyring and saves it back to the same key, and the app reads your edits. Import only the public key and the app still writes the file but can't read edits back. The key stays in this browser and is never synced; a dedicated subkey is a good idea. Orgzly can't read `.gpg` files.

---

## Book Six: Of Keeping Faith with One's Sibling

The phone app and this one each carry their own copy of the shared rules in `src/domain/`: the model, the reducer, sync merging (`sync.ts`), Org (`org.ts`), encryption (`crypto.ts`) and GPG (`pgp.ts`). There is no shared package, on purpose, for now: two small apps are easier to love than one monorepo.

The price is a promise. **The sync file format must stay compatible in both repos.** If you change `sync.ts`, `org.ts`, `crypto.ts`, `pgp.ts` or the shape of the state in `model.ts`/`reducer.ts` here, make the same change in the phone repo (and the other way round), or one of them will start reading the other's file as gibberish. Eternal recurrence is a thought experiment, not a merge strategy.

---

## Book Seven: Of the Higher Directory Structure

```
src/domain/          pure logic and tests, shared in spirit with the phone app:
                       reducer, planner, first steps, recurrence, intentions,
                       overcoming evidence, sync, org, crypto, pgp
src/state/           browser-side state: storage, sync loop, WebDAV client, theme, voice
src/app/             screens (Expo Router): Now, Onboarding, Becoming, Settings, Add
src/ui/              cards, copy, theme (dark by default, light if you ask, never red)
scripts/serve-web.mjs   serves dist/ and relays WebDAV at /__dav
```

Built with Expo (SDK 57) + React Native for Web + TypeScript, because that is the body it was born in. Light mode is opt-in, per browser.

---

## Epilogue

> *"One must still have chaos in oneself to be able to give birth to a dancing star."*
> (*Thus Spoke Zarathustra*, Prologue §5)

You have plenty of chaos. You also have plenty of tabs. This is one of the good ones.

Now close this README. Your first step is waiting, and it is very, very small.
