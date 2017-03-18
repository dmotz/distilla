# Distilla
#### Distill a derived branch build with no mess. Designed for `gh-pages`.
---

Distilla is a simple command-line tool for automatically updating and pushing a
Git branch derived from another. The target use case is deploying a GitHub Pages
(`gh-pages`) branch based on a master branch using a simple config file.

Running `distilla` on your working branch will run build tasks behind the scenes
to generate artifacts then commit and push them to your target branch without
touching your working tree.

The current alternative is often tedious and messy:

- After making a change to your master branch, you run build tasks (e.g.
  creating JS and CSS bundles) which clutter your working directory with
  derived artifacts you don't want to commit to master.

- You typically then have to move these files to a temporary directory so you
  can switch to your `gh-pages` branch. If you have other pending changes on
  master, you'll have to take the time `git stash` them before you can move along.

- Once on the `gh-pages` branch you have to manually move the bundles to their
  destinations, test it out, commit, and push.

- You can then return to master and apply your stash to continue where you left
  off.

Surely we can automate this (and without touching the current working branch)...

Now with Distilla:

- Create a `.distilla` config file in your master branch's root with a list of
  build tasks.

- Run `distilla`. The derived branch is built, committed, and pushed automatically
  without the need to stash changes.


Behind the scenes Distilla creates temporary copies of your repo and performs
some surgery to commit the desired output without manual finagling.


## Install

```
$ npm install -g distilla
```

## Configure

By default Distilla config files are YAML files holding a list of tasks:

```yaml
tasks:
  npm run bundle:
    - bundle.js
    - js/main.js

  stylus -u nib -c main.styl:
    - main.css
    - css/main.css
```

If you don't like YAML you can also write your config files as JSON:

```json
{
  "tasks": {
    "npm run bundle": [
      "bundle.js",
      "js/main.js"
    ],
    "stylus -u nib -c main.styl": [
      "main.css",
      "css/main.css"
    ]
  }
}
```

Under `tasks`, each map key is a build command to run. The value for each key is
pairing of a source (where the build script outputs the file) and a destination
(where you want to put that output on your derived branch).

You can simplify this further by cutting out the intermediate trip to disk. If
your script outputs to `stdout` instead of writing to a file, specify only a
destination in the task:

```yaml
tasks:
  npm run bundle: js/main.js
```

This keeps your task configuration even cleaner reducing the noise of temporary paths.

As a further example, if you wanted to simply move a file unmodified to your
derived branch, you would write this:

```yaml
tasks:
  cat robots.txt: robots.txt
```

When you run `distilla` the tasks' outputs will be put in place on the derived
branch and pushed.


## Preview changes

By setting `preview: true` in your config, Distilla will offer to show you a
working version of the changes in a browser before you push:

```yaml
preview: true

tasks:
  # ...
```

Distilla will run a server for testing out changes and if things look hunky-dory,
it will continue with pushing.


## Other options

By default Distilla will commit with a message that includes the source branch
and commit, e.g.:

```
updated build from master d63374ab730e24ea9021426a91d45fdb0b8b71d0
```

You can customize this message in your config file using the tokens `%h`, `%b`,
and `%m`, which will be replaced with the last commit hash, source branch, and
last commit message respectively.

```yaml
preview: true

commit-msg: rebuild based on %m

tasks:
  # ...
```

You can also override the remote default (`origin`):

```yaml
remote: xanadu
```

...and the target branch (default `gh-pages`):

```yaml
target: website
```


## Asset hashing

One final normally tedious task Distilla can assist with is adding hash suffixes
to hash URLs to break caching after updates.

GitHub Pages employs powerful caching mechanisms (a good thing), but sometimes
the grip is held too tightly when we make amendments.

In the `.distilla` config file, you can a `hashing` task where the keys are
paths to html files and the values are lists of asset paths to update:

```yaml
hashing:
  index.html:
    - js/bundle.js
    - css/main.css
```

Distilla will update the markup with the hashes appended to the query string:
```html
<script src="js/bundle.js?17df15065bd4854c38debe54fd33d099fdf38ed5"></script>
<link href="css/main.css?de67d412baa5bbcb854f067a6d49e3cbf396cbd5" rel="stylesheet" type="text/css">
```


## Caveats

Remember, Distilla is in alpha state and will automatically push commits to your
target branch  (`gh-pages` by default) so be sure to thoroughly test
(using `preview: true`) before running.

If you're using the `stdout` of npm scripts as tasks, be sure to use the `silent`
flag to prevent diagnostic output from being prepended to your build files
(`npm run -s bundle`).


## *distilla*?
Distillation, distribution, J Dilla.
