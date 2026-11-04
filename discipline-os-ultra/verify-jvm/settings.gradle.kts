// Standalone build that compiles and tests ONLY the pure-Kotlin modules (core:model, core:domain).
// Used when the Android SDK / Google Maven are not reachable (e.g. CI sandboxes).
// Run from discipline-os-ultra/:  ./gradlew -p verify-jvm test
// The Gradle Plugin Portal is listed first: it proxies Maven Central and avoids Central's HTTP 429 rate limits.
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}
dependencyResolutionManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
    versionCatalogs {
        create("libs") { from(files("../gradle/libs.versions.toml")) }
    }
}
rootProject.name = "discipline-verify-jvm"
include(":core:model")
include(":core:domain")
project(":core:model").projectDir = file("../core/model")
project(":core:domain").projectDir = file("../core/domain")
