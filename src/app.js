const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcrypt');
const config = require('config');
const { MongoClient, ObjectId } = require('mongodb');

const app = express()
const emailRegex = /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;
const passwordRegex = /^(.{0,7}|[^0-9]*|[^A-Z]*|[^a-z]*|[a-zA-Z0-9]*)$/;

const client = new MongoClient(config.get('mongodb.uri'));
client.connect()
.then(() => { console.log('Connected to MongoDB') })
.catch((error) => { console.error('Error connecting to MongoDB: ', error) });
const db = client.db(config.get('mongodb.db_name'));
const companies = db.collection(config.get('mongodb.companies_collection'));
const users = db.collection(config.get('mongodb.users_collection'));
const storypoints = db.collection(config.get('mongodb.storypoints_collection'));
const jwt_token_blacklist = db.collection(config.get('mongodb.token_blacklist_collection'));

app.use(express.json());
if (config.get('enable_cors')) {
  app.use(cors());
}

async function hashPassword(password) {
  const saltRounds = config.get('bcrypt_salt_rounds')
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

async function checkEmail(email, res) {
  if (await users.findOne({ email: email }) !== null) {
    res.status(409).send('Email already in use')
    return false;
  }
  if (config.get('enable_email_validation') && !emailRegex.test(email)) {
    res.status(400).send('Invalid email')
    return false;
  }
  return true;
}

async function checkPasssword(password, res) {
  if (config.get('enable_password_validation') && passwordRegex.test(password)) {
    res.status(400).send('Invalid password')
    return false;
  }
  return true;
}

async function verifyJWT(req, res) {
  if (!req.headers["authorization"]) {
    res.status(401).send('No auth token provided');
    return false;
  }
  if (await jwt_token_blacklist.findOne({ token: req.headers["authorization"] }) !== null) {
    res.status(401).send('Auth token blacklisted');
    return false;
  }
  try {
    const relevantToken = (req.headers["authorization"]).replace('Bearer ', "");
    const decoded = jwt.verify(relevantToken, config.get('jwt_secret'));
    req.user = decoded;
    return true;
  } catch (error) {
    console.error('Error verifying JWT: ', error);
    res.status(401).send('Invalid auth token');
    return false;
  }
}

async function blacklistJWT(token) {
  if (await jwt_token_blacklist.findOne({ token: token }) !== null) {
    return
  }
  await jwt_token_blacklist.insertOne({ token: token })
}


app.get('/api', async (req, res) => {
  res.send('やった、GeoBase APIが動いてる!')
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
  const token = jwt.sign({ _id: usr._id, email: usr.email }, config.get('jwt_secret'));
  res.json({ token: token });
})

// user login via email and password
app.post('/api/logout', async (req, res) => {
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('User not logged in')
    return
  }
  await blacklistJWT(req.headers["authorization"].replace('Bearer ', ""))
  res.send('User logged out')
})

// get user data
app.get('/api/user', async (req, res) => {
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('User not logged in')
    return
  }
  console.log("USER: "+req.user._id)
  let usr = await users.findOne({ _id: new ObjectId(req.user._id) })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  usr = {
    id: usr._id,
    fullname: usr.fullname,
    email: usr.email,
    company_id: usr.company_id
  }
  res.json({"user": usr})
})

// get base data of companies storypoints
app.get('/api/company/:company_id/storypoints', async (req, res) => {
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('User not logged in')
    return
  }
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: req.user._id, company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
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
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('User not logged in')
    return
  }
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: req.user._id, company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  const spnt = await storypoints.findOne({ _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) })
  if (spnt === null) {
    res.status(404).send('Storypoint not found')
    return
  }
  spnt = {
    id: spnt._id,
    created_at: spnt.created_at,
    created_by: spnt.created_by,
    title: spnt.title,
    coords: spnt.coords,
    description: spnt.description
  }
  res.json({"storypoint": spnt})
})

// get base data of all company users
app.get('/api/company/:company_id/users', async (req, res) => {
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('User not logged in')
    return
  }
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: req.user._id, company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
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
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('User not logged in')
    return
  }
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: req.user._id, company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  let usr = await users.findOne({ _id: new ObjectId(req.params.user_id), company_id: new ObjectId(req.params.company_id) })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  usr = {
    id: usr._id,
    fullname: usr.fullname,
    email: usr.email
  }
  res.json({"user": usr})
})

// add company storypoint
app.post('/api/company/:company_id/storypoints', async (req, res) => {
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('User not logged in')
    return
  }
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: req.user._id, company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
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
    title: req.body["storypoint"].title ? req.body["storypoint"].title : req.body["storypoint"].coords.toString(),
    description: req.body["storypoint"].description ? req.body["storypoint"].description : '',
    images: undefined,
    history: undefined,
    files: undefined,
  }
  const insertRes = await storypoints.insertOne(spnt)
  const storypoint_id = insertRes.insertedId
  await companies.updateOne(
    { _id: new ObjectId(req.params.company_id) }, 
    { $push: { storypoint_ids: spnt._id } }
  )
  res.status(201).json( {"storypoint_id": storypoint_id} )
})

// add company user
app.post('/api/company/:company_id/users', async (req, res) => {
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('Current user not logged in')
    return
  }
  if (!(await users.findOne({ _id: req.user._id, company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('Current user not part of company')
    return
  }
  if (await users.findOne({ company_id: new ObjectId(req.params.company_id), email: req.body["user"].email }) !== null) {
    res.status(409).send('User with this email already exists')
    return
  }
  if (!( await checkEmail(req.body["user"].email, res))) {
    return
  }
  if (!(await checkPasssword(req.body["user"].password, res))) {
    return
  }
  const usr = {
    created_at: await getUnixTime(),
    company_id: new ObjectId(req.params.company_id),
    fullname: req.body["user"].fullname,
    email: req.body["user"].email ? req.body["user"].email : '',
    password: await hashPassword(req.body["user"].password),
  }
  const insertRes = await users.insertOne(usr)
  const user_id = insertRes.insertedId
  await companies.updateOne(
    { _id: new ObjectId(req.params.company_id) }, 
    { $push: { user_ids: usr._id } }
  )
  res.status(201).json({"user_id": user_id })
})

// edit company storypoint
app.put('/api/company/:company_id/storypoints/:storypoint_id', async (req, res) => {
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('User not logged in')
    return
  }
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: req.user._id, company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  let spnt = await storypoints.findOne({ _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) })
  if (spnt === null) {
    res.status(404).send('Storypoint not found')
    return
  }
  spnt = {
    ...spnt,
    title: req.body["storypoint"].title ? req.body["storypoint"].title : spnt.title,
    description: req.body["storypoint"].description ? req.body["storypoint"].description : spnt.description,
    coords: req.body["storypoint"].coords ? req.body["storypoint"].coords : spnt.coords
  }
  await storypoints.updateOne(
    { _id: new ObjectId(req.params.storypoint_id), company_id: new ObjectId(req.params.company_id) },
    { $set: spnt }
  )
  res.send('Storypoint updated')
})

// edit company user
app.put('/api/company/:company_id/users/:user_id', async (req, res) => {
  if (!(await verifyJWT(req, res))) {
    res.status(401).send('User not logged in')
    return
  }
  if (!(await companyExists(req.params.company_id, res))) {
    return
  }
  if (!(await users.findOne({ _id: req.user._id, company_id: new ObjectId(req.params.company_id) }))) {
    res.status(403).send('User not part of company')
    return
  }
  let usr = await users.findOne({ _id: new ObjectId(req.params.user_id), company_id: new ObjectId(req.params.company_id) })
  if (usr === null) {
    res.status(404).send('User not found')
    return
  }
  if (req.body["user"].email) {
    if (!(await checkEmail(req.body["user"].email, res))) {
      return
    }
    usr.email = req.body["user"].email
  }
  if (req.body["user"].password) {
    if (!(await checkPasssword(req.body["user"].password, res))) {
      return
    }
    usr.password = await hashPassword(req.body["user"].password)
  }
  usr = {
    ...usr,
    fullname: req.body["user"].fullname ? req.body["user"].fullname : usr.fullname
  }
  await users.updateOne(
    { _id: new ObjectId(req.params.user_id) },
    { $set: usr }
  )
  res.send('User updated')
})


app.listen(config.get('port'), () => {
  console.log(`GeoBase listening on port ${config.get('port')}!`)
})

