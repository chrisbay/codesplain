let path = require('path');
let antlr = require('antlr4');

// LANGUAGE_RUNTIME_CONFIG_PATH is defined in webpack.config.js
let lang_runtime_config = require(LANGUAGE_RUNTIME_CONFIG_PATH);

let utils = require('./utils.js');
let cache_dir = utils.resolve_cache_dir(lang_runtime_config);

require(path.resolve(cache_dir, 'runtime_modifier.js'))(lang_runtime_config);

let lexer_classname = lang_runtime_config.language + 'Lexer';
let parser_classname = lang_runtime_config.language + 'Parser';

let LexerClass = require(path.resolve(cache_dir, lexer_classname + '.js'))[lexer_classname];
let ParserClass = require(path.resolve(cache_dir, parser_classname + '.js'))[parser_classname];
let ErrorListener = require('./error_listener');
let TerminalNodeImpl = require('antlr4/tree/Tree.js').TerminalNodeImpl;

module.exports = function(input, error_callback) {
    let chars = new antlr.InputStream(input);
    let lexer = new LexerClass(chars);
    let tokens  = new antlr.CommonTokenStream(lexer);
    let parser = new ParserClass(tokens);
    parser.buildParseTrees = true;

    parser.removeErrorListeners();
    parser.addErrorListener(new ErrorListener(error_callback));

    let tree = parser[lang_runtime_config.entry_rule]();

    let process_node = function(node) {
        if (node instanceof TerminalNodeImpl) {
            console.log(node);
            return {
                'type': '.' + parser.symbolicNames[node.symbol.type],
                'begin': node.start.start,
                'end': (node.stop ? node.stop : node.start).stop + 1,
                'children': [],
            };
        } else {
            let ast = {
                'type': parser.ruleNames[node.ruleIndex],
                'begin': node.start.start,
                'end': (node.stop ? node.stop : node.start).stop + 1,
                'children': node.children ? node.children.map(process_node).filter(Boolean) : [],
            };

            let opts = lang_runtime_config.rules[ast.type];
            opts.finalizers.forEach(function(func) {
                ast = func(ast);
            });

            return ast;
        }
    };

    return process_node(tree);
};
