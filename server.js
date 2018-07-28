'use strict';

// Modules
const express = require('express'),
      exphbs = require('express-handlebars'),
      bodyParser = require('body-parser'),
      logger = require('morgan'),
      mongoose = require('mongoose'),
      Promise = require('bluebird'),
      cheerio = require('cheerio'),
      rp = require('request-promise'),

      // Local dependencies
      Article    = require('./models/Article.js'),
      Comment    = require('./models/Comment.js'),

      // Const vars
      app    = express(),
      hbs    = exphbs.create({ defaultLayout: 'main', extname: '.hbs' }),
      PORT   = process.env.PORT || 3000,
      DB_URI = process.env.MONGODB_URI || require('./mongodb_uri.json').LOCAL_URI;

// Handlebars init
app.engine('.hbs', hbs.engine);
app.set('view engine', '.hbs');
if (process.env.PORT) app.enable('view cache');  // Disable view cache for local testing

// Morgan for logging
app.use(logger('dev'));

// Body parser init
app.use(bodyParser.json());
app.use(bodyParser.json({ type: 'application/vnd.api+json' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text());

// Route for static content
app.use(express.static(process.cwd() + '/public'));

// Mongoose init
mongoose.Promise = Promise;
mongoose.connect(DB_URI);
const db = mongoose.connection;

db.on('error', function (err) {
  console.log('Mongoose Error: ', err);
});

db.once('open', function () {
  console.log('Mongoose connection successful.');
});



// Render main site index
app.get('/', (req, res) => {
  rp('http://www.nytimes.com/pages/todayspaper').then(html => {
    const $ = cheerio.load(html),
          promises = [];

    $('h3').each(function(i, element) {
      const link    = $(element).find('a').attr('href'),
            title   = $(element).find('a').text().trim(),
            summary = $(element).next().next().text().trim();

      if (title) {
        promises.unshift(new Promise((resolve, reject) => {
          Article.update(
            { link: link },   // only create new entry if link does not exist in Articles
            { $setOnInsert:
              {
                link: link,
                title: title,
                summary: summary
              }                 
            },
            {
              upsert: true,
              setDefaultsOnInsert: true
            }
          ).then(article => 
            resolve(article)
          );
        }));
      }
    });

    // When all updates are resolved, continue
    Promise.all(promises).then(() => 
      Article.find({}).sort({ date: 1 }).limit(1).populate('comments').exec((err, doc) => 
        res.render('index', {article: doc[0]})
      )
    );
  });
});


// Additional routes
app.get('/articles', (req, res) => {
  Article.find({}).sort({ date: 1 }).limit(10).populate('comments').exec((err, docs) => 
    res.json(docs)
  )
});

app.get('/comments/:id', (req, res) => {
  Article.findById(req.params.id).populate('comments').exec((err, doc) => 
    res.json(doc.comments)
  )
});

app.post('/', (req, res) => {
  Comment.create({comment: req.body.comment}).then(comment => {
    console.log(comment);
    Article.findByIdAndUpdate(
      req.body.id,
      { $push: { "comments": comment._id } }
    ).then(() => 
      res.json(comment)
    )
  })
});

app.delete('/', (req, res) => {
  Article.findById(req.body.id).then(article => {
    const promises = [];

    for (const id of article.comments) {
      promises.push(new Promise((resolve, reject) => {
        Comment.remove({ _id: id}).then(data => resolve(data));
      }));
    }

    Promise.all(promises).then(data => {
      article.comments = [];
      article.save().then(() => res.json(data));
    });
  })
});



// Init server
app.listen(PORT, function () {
  console.log(`App listening on port ${PORT}`);
});