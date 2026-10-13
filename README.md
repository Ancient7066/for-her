# A little place among the stars

A ten chapter, mobile friendly comfort experience made for Aashi, from Vikram. It uses a small procedural WebGL renderer and CSS, with no build step, package install, external images, or audio files.

## Open it

Open `index.html` in a current browser. To run it from a local web address (useful for browser storage), open a terminal in this folder and run `node serve.mjs`, then visit `http://127.0.0.1:8000`.

## Make it yours

- Edit the letter in `index.html` inside `#letter-body`. The on-page **Personalize this note** button also lets you make a local copy in that browser.
- The three constellation prompts are editable on the page and saved only in that browser on that device.
- The comfort, distraction, encouragement, quiet, and smile messages live in `needMessages` in `app.js`.
- The garden flower notes and lucky star lines are also in `app.js`.

Sound starts off and is synthesized locally only after the sound button is selected. The page respects the browser's reduced motion preference; quiet mode is also available at any time.
