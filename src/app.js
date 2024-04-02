const express = require('express')
const session = require('express-session');
const bcrypt = require('bcrypt');
const { MongoClient, ObjectId } = require('mongodb');

const app = express()
const port = 3000
const uri = 'mongodb://alessioc42.duckdns.org:27017'
const db_name = 'geobase'
const session_secret_key = 'your-secret-key'

const client = new MongoClient(uri);

const db = client.db(db_name);
const companies = db.collection('companies');
const users = db.collection('users');
const storypoints = db.collection('storypoints');


app.use(session({
  secret: session_secret_key,
  resave: false,
  saveUninitialized: true
}));


async function hashPassword(password) {
  const saltRounds = 10
  const salt = await bcrypt.genSalt(saltRounds)
  const hash = await bcrypt.hash(password, salt)
  return hash
}

async function comparePasswords(plainPwd, hashedPwd) {
  try {
      const match = await bcrypt.compare(plainPwd, hashedPwd);
      return match;
  } catch (error) {
      console.error('Error comparing passwords: ', error);
  }
}

async function getUnixTime() {
  return Math.floor(Date.now() / 1000)
}

async function companyExists(company_id, res) {
  let company;
  try {
    company = await companies.findOne({ _id: new ObjectId(company_id) });
  } catch (error) {
    console.log('Error finding document by ID: ', error);
    res.status(500).send('Error finding company');
    return false
  }
  if (company !== null) {
    return true;
  } else {
    res.status(404).send('Company not found');
    return false
  }
}


app.get('/api', async (req, res) => {
  res.send('やった、GeoBase APIが動いてる！')
})

// user login via email and password
app.post('/api/login', async (req, res) => {
  const usr = await users.findOne({ email : req.body["user"].email })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  if (!await comparePasswords(req.body["user"].password, usr.password)) {
    res.status(401).send('Incorrect password')
    return
  }
  req.session.user_id = usr._id
  res.send('User logged in')
})

// user login via email and password
app.post('/api/logout', async (req, res) => {
  if (!req.session.user_id) {
    res.status(401).send('User not logged in')
    return
  }
  req.session.destroy()
  res.send('User logged out')
})

// get base data of companies storypoints
app.get('/api/company/:company_id/storypoints', async (req, res) => {
  if (!companyExists(req.params.company_id, res)) {
    return
  }
  console.log(req.params.company_id)
  let spnts = await storypoints.find({ company_id: new ObjectId(req.params.company_id) }).toArray()
  spnts = spnts.map(spnt => {
    return {
      id: spnt._id,
      title: spnt.title,
      coords: spnt.coords
    }
  })
  res.json({"storypoints": spnts})
})

// get full data of company storypoint
app.get('/api/company/:company_id/storypoints/:storypoint_id', async (req, res) => {
  if (!companyExists(req.params.company_id, res)) {
    return
  }
  const spnt = await storypoints.findOne({ _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) })
  if (spnt === null) {
    res.status(404).send('Storypoint not found')
    return
  }
  res.json({"storypoint": spnt})
})

// get base data of all company users
app.get('/api/company/:company_id/users', async (req, res) => {
  if (!companyExists(req.params.company_id, res)) {
    return
  }
  let usrs = await users.find({ company_id: new ObjectId(req.params.company_id) }).toArray()
  usrs = usrs.map(usr => {
    return {
      id: usr._id,
      fullname: usr.fullname,
      email: usr.email
    }
  })
  res.json({"users": usrs})
})

// get company user
app.get('/api/company/:company_id/users/:user_id', async (req, res) => {
  if (!companyExists(req.params.company_id, res)) {
    return
  }
  const usr = await users.findOne({ _id: new ObjectId(req.params.user_id), company_id: new ObjectId(req.params.company_id) })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  res.json({"user": usr})
})

// add company storypoint
app.post('/api/company/:company_id/storypoints', async (req, res) => {
  if (!companyExists(req.params.company_id, res)) {
    return
  }
  if (await storypoints.findOne({ company_id: new ObjectId(req.params.company_id), coords: req.body["storypoint"].coords }) !== null) {
    res.status(409).send('Storypoint with these coordinates already exists')
    return
  }
  const spnt = {
    created_at: await getUnixTime(),
    company_id: new ObjectId(req.params.company_id),
    coords: req.body["storypoint"].coords,
    description: req.body["storypoint"].description ? req.body["storypoint"].description : '',
    images: undefined,
    history: undefined,
    files: undefined,
  }
  await storypoints.insertOne(spnt)
  await companies.updateOne(
    { _id: new ObjectId(req.params.company_id) }, 
    { $push: { storypoint_ids: spnt._id } }
  )
  res.status(201).send('Storypoint created')
})

// add company user
app.post('/api/company/:company_id/users', async (req, res) => {
  if (!companyExists(req.params.company_id, res)) {
    return
  }
  if (await users.findOne({ company_id: new ObjectId(req.params.company_id), email: req.body["user"].email }) !== null) {
    res.status(409).send('User with this email already exists')
    return
  }
  const usr = {
    created_at: await getUnixTime(),
    company_id: new ObjectId(req.params.company_id),
    fullname: req.body["user"].fullname,
    email: req.body["user"].email ? req.body["user"].email : '',
    password: hashPassword(req.body["user"].password),
  }
  await users.insertOne(usr)
  await companies.updateOne(
    { _id: new ObjectId(req.params.company_id) }, 
    { $push: { user_ids: usr._id } }
  )
  res.status(201).send('User created')
})

// edit company storypoint
app.put('/api/company/:company_id/storypoints/:storypoint_id', async (req, res) => {
  if (!companyExists(req.params.company_id, res)) {
    return
  }
  const spnt = await storypoints.findOne({ _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) })
  if (spnt === null) {
    res.status(404).send('Storypoint not found')
    return
  }
  // TODO: make only specific fields editable
  await storypoints.updateOne(
    { _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) },
    { $set: spnt }
  )
  res.send('Storypoint updated')
})

// edit company user
app.put('/api/company/:company_id/users/:user_id', async (req, res) => {
  if (!companyExists(req.params.company_id, res)) {
    return
  }
  const usr = await users.findOne({ _id: new ObjectId(req.params.user_id), company_id: new ObjectId(req.params.company_id) })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  // TODO: make only specific fields editable
  // password needs to be hashed when edited !!
  await users.updateOne(
    { _id: new ObjectId(req.params.user_id), company_id: new ObjectId(req.params.company_id) },
    { $set: usr }
  )
  res.send('User updated')
})


app.listen(port, () => {
  console.log(`GeoBase listening on port ${port}!`)
})

