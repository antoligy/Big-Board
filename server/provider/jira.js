const base64 = require('base-64')
const tmp = require('tmp')
const fetch = require('make-fetch-happen').defaults({
    cacheManager: tmp.dirSync().name,
    cache: 'default'
})

const Column = require('../entity/column')
const Card = require('../entity/card')
const Board = require('../entity/board')

function makeJiraBoardClient(reference, apiKey) {

    const defaultOptions = {}

    const [boardHost, boardId] = reference.split(':')
    const baseUrl = `https://${boardHost}/rest/agile/latest/board/${boardId}`

    if (apiKey) {
      defaultOptions['headers'] = {}
      defaultOptions['headers']['Authorization'] = (apiKey.split(':').length > 1)
        ? `Basic ${base64.encode(apiKey)}` : `Bearer ${apiKey}`
    }

    // Return fetch shim
    return (url, options) => fetch(`${baseUrl}${url}`, Object.assign(defaultOptions, options))
}

function boardFromJiraResults(results) {
  const columns = results.configuration.columnConfig.columns
    .filter(col => col.statuses.length > 0)
    .map(col => {
      const column = new Column
      column.title = col.name
      column.cards = results.issues.issues
        .filter(issue => col.statuses[0].id == issue.fields.status.id)
        .map(issue => {
          const card = new Card
          card.id = issue.key
          card.title = issue.fields.summary
          card.priority = issue.fields.priority
          return card
        })
      return column
    })

  const board = new Board
  board.title = results.board.name
  board.columns = columns
  return board
}

module.exports = function jiraProvider(req, res, next) {

    const fetch = makeJiraBoardClient(req.params.boardId, req.query.apiKey)

    const makeIssueFetch = configuration => {
        const issueQuery = []
        issueQuery.push('fields=summary,status,priority'),
        issueQuery.push('maxResults=500')
        if (configuration.subQuery && configuration.subQuery.query) {
            issueQuery.push(configuration.subQuery.query)
        }
        return fetch(`/issue?${issueQuery.join('&')}`)
    }

    // Grab all of the data JIRA gives us about the board...
    return fetch('/configuration').then(res => res.json())
    .then(configuration => Promise.all([
        fetch('/').then(res => res.json()).then(data => ({ type: 'board', data })),
        new Promise(resolve => resolve({ type: 'configuration', data: configuration })),
        makeIssueFetch(configuration).then(res => res.json()).then(data => ({ type: 'issues', data }))
    ]))
        // Make this data a little easier to work with.
        .then(results => {
            const board = results.filter(result => result.type === 'board').shift().data
            const configuration = results.filter(result => result.type === 'configuration').shift().data
            const issues = results.filter(result => result.type === 'issues').shift().data

            return {board, configuration, issues}
        })

        // Join up this data into a Board!
        .then(boardFromJiraResults)
        .then(board => {
            res.header('Cache-Control', 'max-age=300')
            res.json(board)
        })
        .catch(_ => res.status(500))
}