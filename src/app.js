const express = require('express')
const session = require('express-session');
const bcrypt = require('bcrypt');
const { MongoClient } = require('mongodb');

const app = express()
const port = 3000
const uri = 'mongodb://localhost:27017'
const db_name = 'geobase'
const session_secret_key = 'your-secret-key'

const client = new MongoClient(uri);
client.connect(err => {
  if (err) {
      console.error('Error connecting to MongoDB:', err);
      return;
  }
  console.log('Connected to MongoDB server');
});
const db = client.db(db_name);
const companies = db.collection('companies');
const users = db.collection('users');
const storypoints = db.collection('storypoints');


app.use(session({
  secret: session_secret_key,
  resave: false,
  saveUninitialized: false
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

async function companyExists(company_id) {
  const company = await companies.findOne({ _id: company_id });
  return company !== null;
}


app.get('/api', (req, res) => {
  res.send('Hello World!')
})

// user login via email and password
app.get('/api/login', (req, res) => {
  // TODO
})

// get base data of companies storypoints
app.get('/api/company/:company_id/storypoints', (req, res) => {
  if (!companyExists(req.params.company_id)) {
    res.status(404).send('Company not found')
    return
  }
  let spnts = storypoints.find({ company_id: req.params.company_id })
  spnts = spnts.map(spnt => {
    return {
      id: spnt._id,
      coords: spnt.coords
    }
  })
  res.json({"storypoints": spnts})
})

// get full data of company storypoint
app.get('/api/company/:company_id/storypoints/:storypoint_id', (req, res) => {
  if (!companyExists(req.params.company_id)) {
    res.status(404).send('Company not found')
    return
  }
  const queryResults = storypoints.find({ _id: req.params.storypoint_id, company_id: req.params.company_id })
  if (queryResults.length === 0) {
    res.status(404).send('Storypoint not found')
    return
  } else if (queryResults.length > 1) {
    res.status(500).send('Multiple storypoints found')
    return
  }
  let spnt = queryResults[0]
  res.json({"storypoint": spnt})
})

// get base data of all company users
app.get('/api/company/:company_id/users', (req, res) => {
  if (!companyExists(req.params.company_id)) {
    res.status(404).send('Company not found')
    return
  }
  let cusrs = users.find({ company_id: req.params.company_id })
  cusrs = cusrs.map(usr => {
    return {
      id: usr._id,
      fullname: usr.fullname,
      email: usr.email
    }
  })
  res.json({"users": cusrs})
})

// get company user
app.get('/api/company/:company_id/users/:user_id', (req, res) => {
  if (!companyExists(req.params.company_id)) {
    res.status(404).send('Company not found')
    return
  }
  const queryResults = users.find({ _id: req.params.user_id, company_id: req.params.company_id })
  if (queryResults.length === 0) {
    res.status(404).send('User not found')
    return
  } else if (queryResults.length > 1) {
    res.status(500).send('Multiple users found')
    return
  }
  let usr = queryResults[0]
  res.json({"user": usr})
})

// add company storypoint
app.post('/api/company/:company_id/storypoints', (req, res) => {
  if (!companyExists(req.params.company_id)) {
    res.status(404).send('Company not found')
    return
  }
  // TODO: validate that coords are unique within company
  const spnt = {
    created_at: getUnixTime(),
    company_id: req.params.company_id,
    coords: req.body["storypoint"].coords,
    description: req.body["storypoint"].description ? req.body["storypoint"].description : '',
    images: undefined,
    history: undefined,
    files: undefined,
  }
  storypoints.insertOne(spnt)
  companies.updateOne(
    { _id: req.params.company_id }, 
    { $push: { storypoint_ids: spnt._id } }
  )
  res.status(201).send('Storypoint created')
})

// add company user
app.post('/api/company/:company_id/users', (req, res) => {
  if (!companyExists(req.params.company_id)) {
    res.status(404).send('Company not found')
    return
  }
  // TODO: validate that email is unique
  const usr = {
    created_at: getUnixTime(),
    company_id: req.params.company_id,
    fullname: req.body["user"].fullname,
    email: req.body["user"].email ? req.body["user"].email : '',
    password: hashPassword(req.body["user"].password),
  }
  users.insertOne(usr)
  companies.updateOne(
    { _id: req.params.company_id }, 
    { $push: { user_ids: usr._id } }
  )
  res.status(201).send('User created')
})

// edit company storypoint
app.put('/api/company/:company_id/storypoints/:storypoint_id', (req, res) => {
  if (!companyExists(req.params.company_id)) {
    res.status(404).send('Company not found')
    return
  }
  const queryResults = storypoints.find({ _id: req.params.storypoint_id, company_id: req.params.company_id })
  if (queryResults.length === 0) {
    res.status(404).send('Storypoint not found')
    return
  } else if (queryResults.length > 1) {
    res.status(500).send('Multiple storypoints found')
    return
  }
  const spnt = queryResults[0] // TODO: make only specific fields editable
  storypoints.updateOne(
    { _id: req.params.storypoint_id, company_id: req.params.company_id },
    { $set: spnt }
  )
  res.send('Storypoint updated')
})

// edit company user
app.put('/api/company/:company_id/users/:user_id', (req, res) => {
  if (!companyExists(req.params.company_id)) {
    res.status(404).send('Company not found')
    return
  }
  const queryResults = users.find({ _id: req.params.user_id, company_id: req.params.company_id })
  if (queryResults.length === 0) {
    res.status(404).send('User not found')
    return
  } else if (queryResults.length > 1) {
    res.status(500).send('Multiple users found')
    return
  }
  const usr = queryResults[0] // TODO: make only specific fields editable
  users.updateOne(
    { _id: req.params.user_id, company_id: req.params.company_id },
    { $set: usr }
  )
  res.send('User updated')
})


app.listen(port, () => {
  console.log(`GeoBase listening on port ${port}!`)
})

