var express = require('express');
var bodyParser = require('body-parser');
var logger = require('express-logger');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var inspect = require('util-inspect');
var oauth = require('oauth');
var path = require('path');
var mysql = require('mysql');

const crypto = require('crypto')
const passport = require('passport')
const GithubStrategy = require('passport-github').Strategy
const { stringify } = require('flatted')
const _ = require('underscore')

const metadata = require('gcp-metadata');
const {OAuth2Client} = require('google-auth-library');

const{ google } = require('googleapis');

const COOKIE = process.env.PROJECT_DOMAIN;

var connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "admin"
});

require('dotenv').config(); //Pour les variables dans .env

var app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

const oAuth2Client = new OAuth2Client();

// TWITTER CREDENTIALS
var _twitterConsumerKey = process.env.TWITTER_KEY;
var _twitterConsumerSecret = process.env.TWITTER_SECRET;

// GITHUB CREDENTIALS
var _githubConsumerKey = process.env.GITHUB_KEY;
var _githubConsumerSecret = process.env.GITHUB_SECRET;

// TWITTER CONSUMER
var consumer = new oauth.OAuth(
    "https://twitter.com/oauth/request_token", "https://twitter.com/oauth/access_token", 
    _twitterConsumerKey, _twitterConsumerSecret, "1.0A", "http://127.0.0.1:1337/sessions/callback", "HMAC-SHA1");

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(logger({ path: "log/express.log"}));
app.use(cookieParser());
app.use(session({ secret: "very secret", resave: false, saveUninitialized: true}));

app.use(function(req, res, next) {
  res.locals.session = req.session;
  next();
});

// PB AVEC TOKENREQUEST DU CALLBACK
var tk = "";
var tks = "";

app.get('/', function(request, response) {
	response.sendFile(path.join(__dirname + '/main.html'));
});


// POST AUTH (TWITTER A SPECIFIER)
app.post('/authTwitter', function(req,res){
	res.redirect('/sessions/connect');
});

// GET TEMP TOKEN
app.get('/sessions/connect', function(req, res){
  console.log("/sessions/connect");
  consumer.getOAuthRequestToken(function(error, oauthToken, oauthTokenSecret, results){
    if (error) {
      res.send("Error getting OAuth request token : " + inspect(error), 500);
    } else {  
      req.session.oauthRequestToken = oauthToken;
	  tk = oauthToken;
	  tks = oauthTokenSecret;
      req.session.oauthRequestTokenSecret = oauthTokenSecret;
      res.redirect("https://twitter.com/oauth/authenticate?oauth_token="+req.session.oauthRequestToken);      
    }
  });
});

// EXCHANGE TEMP TOKEN VS TOKEN
app.get('/sessions/callback', function(req, res){
	console.log("/sessions/callback");
    consumer.getOAuthAccessToken(tk, tks, req.query.oauth_verifier, function(error, oauthAccessToken, oauthAccessTokenSecret, results) {
    if (error) {
      res.send("Error getting OAuth access token : " + inspect(error), 500);
    } else {
      req.session.oauthAccessToken = oauthAccessToken;
      req.session.oauthAccessTokenSecret = oauthAccessTokenSecret;
      
      res.redirect('/home');
    }
  });
});

// HOME TWITTER
app.get('/home', function(req, res){
	console.log("/home");
    consumer.get("https://api.twitter.com/1.1/account/verify_credentials.json", req.session.oauthAccessToken, req.session.oauthAccessTokenSecret, function (error, data, response) {
      if (error) {
        console.log(error)
        res.redirect('/sessions/connect');
      } else {
        var parsedData = JSON.parse(data);
		res.render('patient', { title: 'Patient', message: 'Logged in : ' + parsedData.screen_name});
      } 
    });
});

// GITHUB

let scopes = ['notifications', 'user:email', 'read:org', 'repo']
passport.use(
	new GithubStrategy(
		{
			clientID: _githubConsumerKey,
			clientSecret: _githubConsumerSecret,
			callbackURL: 'http://127.0.0.1:1337/sessions/callbackgit',
			scope: scopes.join(' ')
		},
		function(token, tokenSecret, profile, cb) {
			return cb(null, { profile: profile, token: token })
		}
	)
)
passport.serializeUser(function(user, done) {
	done(null, user)
})
passport.deserializeUser(function(obj, done) {
	done(null, obj)
})
app.use(passport.initialize())
app.use(passport.session())

app.use(cookieParser())
app.use(
    session({
        secret: crypto.randomBytes(64).toString('hex'),
        resave: true,
        saveUninitialized: true
    })
)

app.get('/logoff', function(req, res) {
	console.log("/logoff");
	res.clearCookie(COOKIE)
	res.redirect('/')
})

app.get('/auth/github', passport.authenticate('github'))

app.get(
	'/sessions/callbackgit',
	passport.authenticate('github', { successRedirect: '/setcookie', failureRedirect: '/' })
)

var username = "";

app.get('/setcookie', function(req, res) {
	let data = {
		user: req.session.passport.user.profile._json,
		token: req.session.passport.user.token
	}
	console.log("/setcookie");
	res.cookie(COOKIE, JSON.stringify(data))
	username = data.user.login;
	res.redirect('/physician')
})

app.get('/physician', function(req, res){
	console.log("/physician");
	
	connection.query('SELECT * FROM pd_db.User JOIN pd_db.Therapy ON Therapy.User_IDpatient = User.UserID JOIN pd_db.Test ON Test.Therapy_IDtherapy' +
	' = Therapy.therapyID LEFT JOIN pd_db.Test_Session ON Test_Session.Test_IDtest = Test.testID LEFT JOIN pd_db.Note ON' +
	' Note.Test_Session_IDtest_session = Test_Session.test_SessionID;', function(error, results, fields) {
		var i;
		var patientData = "";
		for (i = 0; i < results.length; i++) {
		  patientData += "Patient : " + results[i].username + " - Test : " + results[i].testID + " - Note : " + results[i].note + ' | ';
		}
		res.render('physician', { title: 'Physician', user: 'Logged in : '+ username, message: patientData });
	});
});

// GOOGLE






app.get('*', function(req, res){
    res.redirect('/home');
});

app.listen(1337, function() {
  console.log('App running on port 1337');
});