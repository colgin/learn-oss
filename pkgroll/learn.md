## package.json读取

从package.json中读取内容返回类型，可以用[`type-fest`](https://github.com/sindresorhus/type-fest)里的`PackageJson`类型

```ts
import fs from 'fs';
import path from 'path';
import type { PackageJson } from 'type-fest';
import { fsExists } from './fs-exists';

export const readPackageJson = async (directoryPath: string): Promise<PackageJson> => {
	const packageJsonPath = path.join(directoryPath, 'package.json');

	const exists = await fsExists(packageJsonPath);

	if (!exists) {
		throw new Error(`package.json not found at: ${packageJsonPath}`);
	}

	const packageJsonString = await fs.promises.readFile(packageJsonPath, 'utf8');

	try {
		return JSON.parse(packageJsonString);
	} catch (error) {
		throw new Error(`Cannot parse package.json: ${(error as any).message}`);
	}
};

```

如何处理依赖，哪些需要external？pkgroll会将`peerDependencies` + `dependencies` + `optionalDependencies` 都external掉，只有`devDependencies`的依赖会被打包进去。在代码里

```ts
const externalProperties = [
	'peerDependencies',
	'dependencies',
	'optionalDependencies',
] as const;

export const getExternalDependencies = (packageJson: PackageJson) => {
	const externalDependencies = [];

	for (const property of externalProperties) {
		const externalDependenciesObject = packageJson[property];

		if (externalDependenciesObject) {
			externalDependencies.push(...Object.keys(externalDependenciesObject));
		}
	}

	return externalDependencies;
};

// cli.ts
const externalDependencies = getExternalDependencies(packageJson).filter(
  dependency => !(dependency in aliases),
).flatMap(dependency => [
  dependency,
  new RegExp(`^${dependency}/`),
]);
```

由于pkgroll是一个只负责生成esm和commonjs的打包器，esm规范的文件一般需要在打包器中使用，依赖解析的工作可以交给打包工具。而commonjs代码跑在Node环境中，Node本身就可以解析模块。作为前端开发者我们比较熟悉dependencies和devDependencies这俩，实际开发中我们会将项目实际运行需要依赖的包放到dependencies里，将开发依赖放到devDependencies。当我们的包被被人安装是，会将dependencies里的东西都安装一遍，而devDependencies里的依赖则不会被安装。

## rollup plugin

```ts
import { builtinModules } from 'module';
import type { Plugin } from 'rollup';

type Semver = [number, number, number];

const compareSemver = (
	semverA: Semver,
	semverB: Semver,
) => (
	semverA[0] - semverB[0]
	|| semverA[1] - semverB[1]
	|| semverA[2] - semverB[2]
);

/**
 * Implemented as a plugin instead of the external API
 * to support altering the import specifier to remove `node:`
 *
 * Alternatively, we can create a mapping via output.paths
 * but this seems cleaner
 */
export const externalizeNodeBuiltins = ({ target }: {
	target: string[];
}): Plugin => {
	/**
	 * Only remove protocol if a Node.js version that doesn't
	 * support it is specified.
	 */
	const stripNodeProtocol = target.some((platform) => {
		platform = platform.trim();

		// Ignore non Node platforms
		if (!platform.startsWith('node')) {
			return;
		}

		const parsedVersion = platform.slice(4).split('.').map(Number);
		const semver: Semver = [
			parsedVersion[0],
			parsedVersion[1] ?? 0,
			parsedVersion[2] ?? 0,
		];

		// 特定版本的才会保留 node:
		// Pass in a Node.js target that that doesn't support it to strip the node: protocol from imports:
		return !(
			// 12.20.0 <= x < 13.0.0
			(
				compareSemver(semver, [12, 20, 0]) >= 0
				&& compareSemver(semver, [13, 0, 0]) < 0
			)

			// 14.13.1 <= x
			|| compareSemver(semver, [14, 13, 1]) >= 0
		);
	});

	return {
		name: 'externalize-node-builtins',
		resolveId: (id) => {
			const hasNodeProtocol = id.startsWith('node:');
			if (stripNodeProtocol && hasNodeProtocol) {
				// 移除node:
				id = id.slice(5);
			}

			if (builtinModules.includes(id) || hasNodeProtocol) {
				return {
					id,
					external: true,
				};
			}
		},
	};
};

```

这个插件解决了特定版本下 `node:xxx` protocal协议的导入，如果Node版本不对的话，会把这些都转化为`xxx`，并且external掉。

### 处理esm和cjs的 interoperability

pkgroll支持在main字段放`.mjs`，这样就是在Node环境下的esm文件（Node中只会看main字段找对应的文件，后缀为mjs，就用esm规范加载它，否则则看type字段是否是`module`， 如果是，也会以esm规范加载，否则就用commonjs规范加载）

在ESM中使用`require()`或`require.resolve()`可以无缝编译到commonjs，但是编译到esm的时候，Node会报错因为在module上下文不存在`require`函数。前面我们说到pkgroll支持打包到Node环境下的esm，所以这个问题就需要解决。

pkgroll利用了[`module.createRequire`](https://nodejs.org/api/module.html#modulecreaterequirefilename) 来解决这个问题。

```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// sibling-module.js is a CommonJS module.
const siblingModule = require('./sibling-module');
```

看下实际效果。

```json
{
  "main": "dist/index.mjs", // mjs后缀也为esm规范文件
  "module": "dist/index.js", // 固定为 esm文件
  "types": "dist/index.d.ts"
}
```

```ts
// sum.ts
exports.sum = (a: number, b: number) => {
  return a + b
}
```

```ts
// index.ts
const { sum } = require('./sum')

export const addOne = () => {
  return sum(4, 5) + 1
}
```

esm文件中（也就是dist/index.mjs)中，

```js
import { createRequire } from 'module';

var require$1 = (
			true
				? /* @__PURE__ */ createRequire(import.meta.url)
				: require
		);

const { sum } = require$1("./sum");
const addOne = () => {
  return sum(4, 5) + 1;
};

export { addOne }
```

在浏览器端的esm文件中（也就是dist/index.js)中，

如果把上面package.json里main改成`.js`后缀，也就是会生成commonjs规范的文件

```js
Object.defineProperty(exports, '__esModule', { value: true });

var module$1 = require('module');

var require$1 = (
			false
				? /* @__PURE__ */ module$1.createRequire((typeof document === 'undefined' ? new (require('u' + 'rl').URL)('file:' + __filename).href : (document.currentScript && document.currentScript.src || new URL('index.js', document.baseURI).href)))
				: require
		);
const { sum } = require$1("./sum");
const addOne = () => {
  return sum(4, 5) + 1;
};

exports.addOne = addOne;
```

具体如何实现的，可以看到 `create-require.ts`

```ts
import type { Plugin } from 'rollup';
import replace from '@rollup/plugin-replace';
import inject from '@rollup/plugin-inject';

const virtualModuleName = 'pkgroll:create-require';

/**
 * Since rollup is bundled by rollup, it needs to add a run-time
 * suffix so that this doesn't get replaced.
 */
const isEsmVariableName = `IS_ESM${Math.random().toString(36).slice(2)}`;

/**
 * Plugin to seamlessly allow usage of `require`
 * across CJS and ESM modules.
 *
 * This is usually nor a problem for CJS outputs,
 * but for ESM outputs, it must be used via
 * createRequire.
 *
 * This plugin automatically injects it for ESM.
 */
export const createRequire = (): Plugin => ({
	...inject({
		require: virtualModuleName,
	}),

	name: 'create-require',

	resolveId: source => (
		(source === virtualModuleName)
			? source
			: null
	),

	load(id) {
		if (id !== virtualModuleName) {
			return null;
		}

		return `
		import { createRequire } from 'module';

		export default (
			${isEsmVariableName}
				? /* @__PURE__ */ createRequire(import.meta.url)
				: require
		);
		`;
	},
});

export const isFormatEsm = (
	isEsm: boolean,
): Plugin => ({
	name: 'create-require-insert-format',

	// Pick out renderChunk because it's used as an output plugin
	renderChunk: replace({
		[isEsmVariableName]: isEsm,
	}).renderChunk!,
});

```

这里首先使用 `@rollup/plugin-inject`给注入了`require`函数，只要用到 `require`的地方就会导入一个虚拟的包`pkgroll:create-require`， 在插件中，发现如果是虚拟的包名的话，会加上一段`createRequire`语句。这里可以看到有一个isEsmVariableName的变量，如果为false则使用原生的`require`, 这个变量名`IS_ESM`开头的，这个变量最终是以插件的形式被替换为 true/false

```ts
plugins: [
  isFormatEsm(exportEntry.type === 'module'),
]

export const isFormatEsm = (
	isEsm: boolean,
): Plugin => ({
	name: 'create-require-insert-format',

	// Pick out renderChunk because it's used as an output plugin
	renderChunk: replace({
		[isEsmVariableName]: isEsm,
	}).renderChunk!,
});

```
