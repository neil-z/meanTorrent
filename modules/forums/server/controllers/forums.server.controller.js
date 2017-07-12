'use strict';

/**
 * Module dependencies
 */
var path = require('path'),
  config = require(path.resolve('./config/config')),
  mongoose = require('mongoose'),
  errorHandler = require(path.resolve('./modules/core/server/controllers/errors.server.controller')),
  moment = require('moment'),
  User = mongoose.model('User'),
  Forum = mongoose.model('Forum'),
  Topic = mongoose.model('Topic'),
  Reply = mongoose.model('Reply'),
  Thumb = mongoose.model('Thumb'),
  async = require('async'),
  traceLogCreate = require(path.resolve('./config/lib/tracelog')).create;

var traceConfig = config.meanTorrentConfig.trace;
var forumsConfig = config.meanTorrentConfig.forumsConfig;

/**
 * list forums
 * @param req
 * @param res
 */
exports.list = function (req, res) {
  var findForumsList = function (callback) {
    Forum.find()
      .sort('category order -createdat')
      .populate({
        path: 'lastTopic',
        populate: {
          path: 'user lastUser',
          select: 'username displayName profileImageURL uploaded downloaded'
        }
      })
      .populate('moderators', 'username displayName profileImageURL uploaded downloaded')
      .exec(function (err, forums) {
        if (err) {
          callback(err, null);
        } else {
          callback(null, forums);
        }
      });
  };

  var forumsTopicsCount = function (callback) {
    Topic.aggregate({
      $project: {
        'forum': '$forum',
        'day': {
          '$dayOfMonth': '$createdAt'
        }
      }
    }, {
      $match: {
        day: moment.utc().date()
      }
    }, {
      $group: {
        _id: '$forum',
        count: {$sum: 1}
      }
    }).exec(function (err, counts) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, counts);
      }
    });
  };

  var forumsRepliesCount = function (callback) {
    Topic.aggregate({
      $unwind: '$_replies'
    }, {
      $project: {
        'forum': '$forum',
        //'title': '$title',
        //'createdAt': '$_replies.createdAt',
        'day': {
          '$dayOfMonth': '$_replies.createdAt'
        }
      }
    }, {
      $match: {
        day: moment.utc().date()
      }
    }, {
      $group: {
        _id: '$forum',
        count: {$sum: 1}
      }
    }).exec(function (err, counts) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, counts);
      }
    });
  };

  async.parallel([findForumsList, forumsTopicsCount, forumsRepliesCount], function (err, results) {
    if (err) {
      return res.status(422).send(err);
    } else {
      res.json({
        forumsList: results[0],
        forumsTopicsCount: results[1],
        forumsRepliesCount: results[2]
      });
    }
  });
};

/**
 * read forum
 * @param req
 * @param res
 */
exports.read = function (req, res) {
  res.json(req.forum);
};

/**
 * listTopics
 * @param req
 * @param res
 */
exports.listTopics = function (req, res) {
  Topic.find({
    forum: req.params.forumId
  })
    .sort('-isTop -lastReplyAt -createdAt')
    .populate('user', 'username displayName profileImageURL uploaded downloaded')
    .populate('lastUser', 'username displayName profileImageURL uploaded downloaded')
    .exec(function (err, topics) {
      if (err) {
        return res.status(422).send({
          message: errorHandler.getErrorMessage(err)
        });
      }
      res.json(topics);
    });
};

/**
 * postNewTopic
 * @param req
 * @param res
 */
exports.postNewTopic = function (req, res) {
  var forum = req.forum;
  var topic = new Topic(req.body);
  topic.forum = forum;
  topic.user = req.user;

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);

      forum.update({
        $inc: {topicCount: 1},
        lastTopic: topic
      }).exec();
    }
  });
};

/**
 * read readTopic
 * @param req
 * @param res
 */
exports.readTopic = function (req, res) {
  var topic = req.topic;

  topic.update({
    $inc: {viewCount: 1}
  }).exec();

  res.json(topic);
};

/**
 * updateTopic
 * @param req
 * @param res
 */
exports.updateTopic = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;

  topic.content = req.body.content;
  topic.updatedAt = Date.now();
  topic.updatedBy = req.user;

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);
    }
  });
};

/**
 * toggleTopicReadonly
 * @param req
 * @param res
 */
exports.toggleTopicReadonly = function (req, res) {
  var topic = req.topic;

  topic.readOnly = !topic.readOnly;

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);
    }
  });
};

/**
 * thumbsUp
 * @param req
 * @param res
 */
exports.thumbsUp = function (req, res) {
  var exist = false;
  var topic = req.topic;
  var thumb = new Thumb();
  thumb.user = req.user;
  thumb.score = forumsConfig.thumbs_up_score;

  if (req.query.replyId) {
    topic._replies.forEach(function (r) {
      if (r._id.equals(req.query.replyId)) {
        //check if already exist
        exist = false;
        r._scoreList.forEach(function (sr) {
          if (sr.user._id.equals(req.user._id)) {
            exist = true;
          }
        });
        if (exist) {
          return res.json(topic);
        } else {
          r._scoreList.push(thumb);
        }
      }
    });
  } else {
    //check if already exist
    exist = false;
    topic._scoreList.forEach(function (sr) {
      if (sr.user._id.equals(req.user._id)) {
        exist = true;
      }
    });
    if (exist) {
      return res.json(topic);
    } else {
      topic._scoreList.push(thumb);
    }
  }

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);
    }
  });
};

/**
 * deleteTopic
 * @param req
 * @param res
 */
exports.deleteTopic = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;
  var rcount = topic.replyCount;

  topic.remove(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);

      Topic.findOne({
        forum: forum._id
      })
        .sort('-lastReplyAt -createdAt')
        .exec(function (err, topic) {
          if (!err) {
            forum.update({
              $inc: {topicCount: -1, replyCount: -rcount},
              lastTopic: topic
            }).exec();
          }
        });

      //create trace log
      traceLogCreate(req, traceConfig.action.forumDeleteTopic, {
        forum: forum._id,
        topic: topic._id
      });
    }
  });
};

/**
 * postNewReply
 * @param req
 * @param res
 */
exports.postNewReply = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;
  var reply = new Reply(req.body);
  reply.user = req.user;

  topic._replies.push(reply);
  topic.replyCount++;
  topic.lastReplyAt = Date.now();
  topic.lastUser = req.user;

  topic.save(function (err) {
    if (err) {
      return res.status(422).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      res.json(topic);

      forum.update({
        $inc: {replyCount: 1},
        lastTopic: topic
      }).exec();
    }
  });
};

/**
 * updateReply
 * @param req
 * @param res
 */
exports.updateReply = function (req, res) {
  var topic = req.topic;

  topic._replies.forEach(function (t) {
    if (t._id.equals(req.params.replyId)) {
      t.content = req.body.content;
      t.updatedAt = Date.now();
      t.updatedBy = req.user;

      topic.save(function (err) {
        if (err) {
          return res.status(422).send({
            message: errorHandler.getErrorMessage(err)
          });
        } else {
          res.json(topic);
        }
      });
    }
  });
};


/**
 * deleteReply
 * @param req
 * @param res
 */
exports.deleteReply = function (req, res) {
  var forum = req.forum;
  var topic = req.topic;

  topic._replies.forEach(function (t) {
    if (t._id.equals(req.params.replyId)) {
      topic._replies.pull(t);
      topic.replyCount--;
      topic.save(function (err) {
        if (err) {
          return res.status(422).send({
            message: errorHandler.getErrorMessage(err)
          });
        } else {
          res.json(topic);

          forum.update({
            $inc: {replyCount: -1}
          }).exec();

          //create trace log
          traceLogCreate(req, traceConfig.action.forumDeleteReply, {
            forum: forum._id,
            topic: topic._id,
            reply: req.params.replyId
          });
        }
      });
    }
  });
};

/**
 * Invitation middleware
 */
exports.topicById = function (req, res, next, id) {

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).send({
      message: 'Topic is invalid'
    });
  }

  Topic.findById(id)
    .populate('user', 'username displayName profileImageURL uploaded downloaded score')
    .populate('lastUser', 'username displayName profileImageURL uploaded downloaded')
    .populate('updatedBy', 'username displayName profileImageURL uploaded downloaded')
    .populate('_scoreList.user', 'username displayName profileImageURL uploaded downloaded')
    .populate('_replies.user', 'username displayName profileImageURL uploaded downloaded')
    .populate('_replies.updatedBy', 'username displayName profileImageURL uploaded downloaded')
    .populate('_replies._scoreList.user', 'username displayName profileImageURL uploaded downloaded')
    .exec(function (err, topic) {
      if (err) {
        return next(err);
      } else if (!topic) {
        return res.status(404).send({
          message: 'No topic with that identifier has been found'
        });
      }
      req.topic = topic;
      next();
    });
};