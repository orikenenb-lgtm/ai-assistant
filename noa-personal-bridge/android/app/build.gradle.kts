import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "ai.noa.bridge.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "ai.noa.personalbridge"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        // Debounce window after the last message of a conversation before a draft is requested.
        buildConfigField("long", "DEBOUNCE_MILLIS", "15000L")
        // Compile-time master switch for the reply path. Even when true, sending stays
        // disabled until the user explicitly enables the experimental toggle in Settings,
        // and every single send still needs an explicit in-app approval.
        buildConfigField("boolean", "REPLY_PATH_COMPILED_IN", "true")
    }

    // S-M2: optional release signing, read ONLY from environment variables (no secrets in the repo).
    // Applied only when all four are set; otherwise `assembleRelease` produces an unsigned APK.
    //   NOA_KEYSTORE_FILE, NOA_KEYSTORE_PASSWORD, NOA_KEY_ALIAS, NOA_KEY_PASSWORD
    val releaseSigning = listOf("NOA_KEYSTORE_FILE", "NOA_KEYSTORE_PASSWORD", "NOA_KEY_ALIAS", "NOA_KEY_PASSWORD")
        .map { System.getenv(it)?.takeIf(String::isNotBlank) }
    if (releaseSigning.all { it != null }) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseSigning[0]!!)
                storePassword = releaseSigning[1]
                keyAlias = releaseSigning[2]
                keyPassword = releaseSigning[3]
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isDebuggable = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.service)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.okhttp)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
}
