// Configuration that can only be read by the compiler.

module.exports = {
	'grammar_file': 'Java8.JavaScriptTarget.g4',
    'needs_java_func_data': true,
    'tree_matcher_specs': require('./java8.tree_matcher_specs.js'),
};
