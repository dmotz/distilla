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
const SServer  = require('static-server')
const getPort  = require('getport')
const cheerio  = require('cheerio')
const {argv}   = require('yargs').version()


const startDir    = process.cwd()
const tempRoot    = os.tmpdir()
const workingPath = 'distilla_' + uuid.v4()

const msgTokens = {
  hash:    '%h',
  branch:  '%b',
  message: '%m'
}

const tokenTasks = {
  hash:    'git rev-parse HEAD',
  branch:  'git rev-parse --abbrev-ref HEAD',
  message: 'git log -1 --pretty=%B'
}

const defaults = {
  'target-branch': 'gh-pages',
  'commit-msg':    `updated build from ${msgTokens.branch} ${msgTokens.hash}`,
  remote:          'origin',
  preview:         false,
  hashing:         {}
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
  Object.values(config.tasks).forEach(val => {
    const [, oPath] = getPaths(val)
    child.execSync('git add ' + oPath)
  })

  Object.keys(config.hashing).forEach(path => child.execSync('git add ' + path))

  try {
    child.execSync(`git commit -m "${commitMsg}"`)
  } catch (e) {
    die('No changes to commit in build output, aborting push.')
  }
  child.execSync(`git push ${config.remote} ${config['target-branch']}`, {stdio: 'inherit'})
  process.chdir(startDir)
  child.execSync(`git fetch ${config.remote} ${targetBranch}:${targetBranch}`, {stdio: 'inherit'})
  cleanUp()
  console.log(chalk.green('Complete'))
  process.exit(0)
}


let tempCreated = false
let raw
let config

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

if (!config.tasks || !Object.keys(config.tasks).length) {
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

const commitMsg = Object.keys(msgTokens).reduce((a, k) => {
  const token = msgTokens[k]

  return a.includes(token)
    ? a.replace(token, child.execSync(tokenTasks[k]).toString().trim())
    : a

}, config['commit-msg'])

Object.entries(config.tasks).forEach(([cmd, val]) => {
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

if (Object.keys(config.hashing).length) {
  Object.entries(config.hashing).forEach(([htmlPath, assets]) => {
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
