let path = require('path');
let fs = require('fs-promise');
let child_process = require('child-process-promise');
let antlr = require('antlr4');

let config = require('../config.js');
let expect_error = require('./expect_error.js');
let tree_matcher = require('./tree_matcher.js');
let java_func_data_generator = require('./java_func_data_generator.js');

let array_diff = function(a, b) {
    return a.filter(function(i) {return b.indexOf(i) === -1;});
};

module.exports = function(lang_compile_config, lang_runtime_config) {
    // Figure out the language key
    let language_key = lang_runtime_config.language.toLowerCase();

    // Figure out the path to the grammar file
    let g4_path = lang_compile_config.grammar_path;
    if (!g4_path) {
        g4_path = path.resolve(__dirname, '..', 'grammars-v4', language_key, lang_compile_config.grammar_file);
    }

    // Figure out the path to the cache directory
    let cache_dir = config.resolve_cache_dir(lang_runtime_config);
    let cache_g4_path = path.resolve(cache_dir, lang_runtime_config.language + '.g4');


    let compile_promise = async function() {
        // Make sure the cache directory exists
        await fs.mkdir(config.cache_path).catch(expect_error('EEXIST', function() {}));

        // Make sure the language cache directory exists
        await fs.mkdir(cache_dir).catch(expect_error('EEXIST', function() {}));

        // Copies the g4 file into the cache directory
        await fs.copy(g4_path, cache_g4_path);

        // Prepare options to the antlr compiler that generates the antlr lexer and antlr parser
        let cmd = 'java';
        let args = [
            '-Xmx500M',
            '-cp', '../../bin/antlr-4.6-complete.jar',
            'org.antlr.v4.Tool',
            '-long-messages',
            lang_compile_config.generate_listener ? '-listener' : '-no-listener',
            lang_compile_config.generate_visitor ? '-visitor' : '-no-visitor',
            '-Dlanguage=JavaScript',
            lang_runtime_config.language + '.g4',
        ];
        let opts = {
            'cwd': cache_dir,
            'stdio': ['ignore', process.stdout, process.stderr],
        };

        // Call antlr
        await child_process.spawn(cmd, args, opts);

        if (lang_compile_config.needs_java_func_data) {
            await fs.stat(config.cache_path + '/java_func_data')
                .catch(expect_error('ENOENT', java_func_data_generator));
        }

        // Make sure the generated parser has the same rules as our config file.
        let parser_classname = lang_runtime_config.language + 'Parser';
        let ParserClass = require(cache_dir + '/' + parser_classname + '.js')[parser_classname];
        let parser = new ParserClass();

        // Create an array of symbol (terminal) names
        let symbol_name_map = ['_EPSILON', '_EOF', '_INVALID']
            .concat(parser.symbolicNames.slice(1))
            .map(function(val) {return val ? '.' + val : undefined;});

        // Create the list of rule names (both terminals and non-terminals)
        let parser_rules = parser.ruleNames.concat(symbol_name_map.filter(Boolean));
        let config_rules = Object.keys(lang_runtime_config.rules);

        // Make sure the parser doesn't have extra rules
        let config_missing = array_diff(parser_rules, config_rules);
        if (config_missing.length) {
            throw new Error('Missing rules ' + JSON.stringify(config_missing));
        }

        // Make sure our config doesn't have extra rules
        let config_extra = array_diff(config_rules, parser_rules);
        if (config_extra.length) {
            throw new Error('Extra rules ' + JSON.stringify(config_extra));
        }

        // Generate the runtime config modifier
        let code = '';
        code += '// This function is generated by app/compile.js.\n';
        code += '// Do not attempt to make changes. They will be over-written.\n\n';

        // This is a function that modifies the lang_runtime_config
        code += 'module.exports = function(lang_runtime_config) {\n';

        // It adds a symbol_name_map array
        code += 'lang_runtime_config.symbol_name_map = ' + JSON.stringify(symbol_name_map, null, 2) + ';\n';

        // And a rule_name_map array
        code += 'lang_runtime_config.rule_name_map = ' + JSON.stringify(parser.ruleNames, null, 2) + ';\n';

        // And a tree_matcher function
        if (lang_compile_config.tree_matcher_specs) {
            let generator = await tree_matcher.make_generator(lang_compile_config, lang_runtime_config);
            let tree_matchers = lang_compile_config.tree_matcher_specs.map(generator);
            code += 'lang_runtime_config.tree_matcher = function(root) {\n' + tree_matchers.join('\n') + '\n};\n';
        }

        code += '};';

        // Write the runtime config modifier
        let modifier_path = path.resolve(cache_dir, 'runtime_config_modifier.js');
        await fs.writeFile(modifier_path, code);
    };

    // Stat the cache directory, which is the standard way if checking if it exists.
    return fs.stat(cache_dir)
        .catch(expect_error('ENOENT', compile_promise))
        .then(function() {
            // In either case, return an object describing the results.
            return {
                // Currently, this description is just where the compiled files are stored.
                'cache_dir': cache_dir
            };
        });
};
