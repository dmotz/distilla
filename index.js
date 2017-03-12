#!/usr/bin/env node

const fs       = require('fs')
const os       = require('os')
const path     = require('path')
const child    = require('child_process')
const readline = require('readline')
const crypto   = require('crypto')
const uuid     = require('node-uuid')
const yargs    = require('yargs')
const yaml     = require('js-yaml')
const chalk    = require('chalk')
const npmPath  = require('npm-path')
const SServer  = require('static-server')
const getPort  = require('getport')
const cheerio  = require('cheerio')


const startDir    = process.cwd()
const tempRoot    = os.tmpdir()
const workingPath = 'distilla_' + uuid.v4()
const defaults    = {
  'target-branch': 'gh-pages',
  'commit-msg':    'updated build from %b %h',
  remote:          'origin',
  preview:         false,
  hashing:         null
}

const die = (msg, e) => {
  console.error(chalk.red(msg))
  if (e) {
    console.error(chalk.red(e))
  }
  if (tempCreated) {
    cleanUp()
  }
  process.exit(1)
}

const splitPair = o => {
  const [key] = Object.keys(o)
  return [key, o[key]]
}

const getPaths = val =>
  Array.isArray(val)
  ? val.length === 1
    ? [null, val[0]]
    : val
  : [null, val]

const cleanUp = () => {
  console.log('Cleaning up...')
  process.chdir(tempRoot)
  child.execSync('rm -rf ' + fullTempPath)
}

const confirmationPrompt = cb => {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout
  })
  rl.question(chalk.green('Continue deploy? (Y/n): '), answer => {
    rl.close()
    answer = answer.toLowerCase()

    if (answer === 'n') {
      die('Aborting deploy')
    }

    if (!answer || answer === 'y') {
      return cb()
    }

    console.log(chalk.red('Unrecognized command'))
    confirmationPrompt(cb)
  })
}

const finale = () => {
  config.tasks.forEach(task => {
    const [, oPath] = getPaths(splitPair(task)[1])
    child.execSync('git add ' + oPath)
  })
  child.execSync(`git commit -m "${commitMsg}"`)
  child.execSync(`git push ${config.remote} ${config['target-branch']}`, {stdio: 'inherit'})
  process.chdir(startDir)
  child.execSync(`git fetch ${config.remote} ${targetBranch}:${targetBranch}`, {stdio: 'inherit'})
  cleanUp()
  console.log(chalk.green('Complete'))
}


let tempCreated = false
let raw
let config
let commitMsg

try {
  raw = fs.readFileSync('.distilla', 'utf8')
} catch (e) {
  die('Could not find .distilla config file')
}

try {
  config = yaml.safeLoad(raw)
} catch (e) {
  die('Could not parse .distilla yaml', e)
}

config = Object.assign({}, defaults, config)

if (!config.tasks || !config.tasks.length) {
  die('No tasks are specified in .distilla')
}

const targetBranch = config['target-branch']
const fullTempPath = path.join(tempRoot, workingPath)
const sourcePath   = path.join(fullTempPath, 'source')
const buildPath    = path.join(fullTempPath, 'build')

fs.mkdirSync(fullTempPath)
tempCreated = true
fs.mkdirSync(sourcePath)
fs.mkdirSync(buildPath)
child.execSync('cp -r . ' + sourcePath)
child.execSync('cp -r . ' + buildPath)
process.chdir(buildPath)


try {
  child.execSync('git checkout .', {stdio: 'ignore'})
  child.execSync('git checkout ' + targetBranch, {stdio: 'ignore'})
} catch (e) {
  die(`Target branch '${targetBranch}' could not be checked out`, e)
}

process.chdir('..')
process.chdir(sourcePath)

if (fs.existsSync('package.json')) {
  if (fs.existsSync('node_modules')) {
    child.execSync('rm -rf node_modules')
  }
  child.execSync('npm install', {stdio: 'ignore'})
}

commitMsg = config['commit-msg']

if (commitMsg.includes('%b')) {
  commitMsg = commitMsg.replace('%b', child.execSync('git rev-parse --abbrev-ref HEAD').toString().trim())
}

if (commitMsg.includes('%h')) {
  commitMsg = commitMsg.replace('%h', child.execSync('git rev-parse HEAD').toString().trim())
}

if (commitMsg.includes('%m')) {
  commitMsg = commitMsg.replace('%m', child.execSync('git log -1 --pretty=%B').toString().trim())
}

config.tasks.forEach(task => {
  const [cmd, val] = splitPair(task)

  let [iPath, oPath] = getPaths(val)
  let proc

  console.log(`${cmd} ${chalk.green('->')} ${oPath}`)
  try {
    proc = child.execSync(cmd, {stdio: ['ignore', 'pipe', process.stderr]})
  } catch (e) {
    die('Command failed, aborting')
  }

  try {
    const dest = path.join(buildPath, oPath)
    if (!iPath) {
      fs.writeFileSync(dest, proc.toString())
    } else {
      if (!fs.existsSync(iPath)) {
        die('Failed to find generated artifact at ' + iPath)
      }
      child.execSync(`cp -r ${iPath} ${dest}`)
    }
  } catch (e) {
    die('Error copying artifact', e)
  }
})

process.chdir('..')
process.chdir(buildPath)

if (config.hashing) {
  config.hashing.forEach(task => {
    const [htmlPath, assets] = splitPair(task)
    let html

    try {
      html = fs.readFileSync(htmlPath)
    } catch (e) {
      die(`Could not find '${htmlPath}' for hashing`)
    }

    const $ = cheerio.load(html)

    assets.forEach(assetPath => {
      const isScript = assetPath.endsWith('.js')

      let match = $((isScript ? 'script[src' : 'link[href') + `^='${assetPath}']`)

      if (!match || !match[0]) {
        die(`Could not find ${isScript ? 'script' : 'link'} tag referencing '${assetPath}' in ${htmlPath}`)
      }

      if (!fs.existsSync(assetPath)) {
        die(`Could not find '${assetPath}' on branch '${targetBranch}'`)
      }

      $(match[0]).attr(
        isScript ? 'src' : 'href',
        assetPath + '?' + crypto.createHash('sha1').update(fs.readFileSync(assetPath)).digest('hex')
      )
    })

    fs.writeFileSync(htmlPath, $.html())
  })
}

if (config.preview) {
  getPort(3000, (e, p) => {
    if (e) {
      die('Failed getting port', e)
    }
    const server = new SServer({rootPath: '.', port: p})
    server.start(() => {
      console.log()
      console.log(chalk.yellow('Confirm changes at http://localhost:' + p))
      confirmationPrompt(() => {
        server.stop()
        finale()
      })
    })
  })
} else {
  finale()
}
