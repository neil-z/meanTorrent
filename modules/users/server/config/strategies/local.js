'use strict';

/**
 * Module dependencies
 */
var passport = require('passport'),
  LocalStrategy = require('passport-local').Strategy,
  User = require('mongoose').model('User');

module.exports = function () {
  // Use local strategy
  passport.use(new LocalStrategy(
    {
      usernameField: 'usernameOrEmail',
      passwordField: 'password'
    },
    function (usernameOrEmail, password, done) {
      User.findOne({
        $or: [{
          username: usernameOrEmail.toLowerCase()
        }, {
          email: usernameOrEmail.toLowerCase()
        }]
      }).populate('invited_by', 'username displayName profileImageURL')
        .exec(function (err, user) {
          console.log(user);
          if (err) {
            return done(err);
          }
          if (!user || !user.authenticate(password)) {
            return done(null, false, {
              message: 'Invalid username or password (' + (new Date()).toLocaleTimeString() + ')'
            });
          }
          if (user.status === 'banned') {
            return done(null, false, {
              message: 'You are banned from the server!'
            });
          }

          return done(null, user);
        });
    }
  ));
};
