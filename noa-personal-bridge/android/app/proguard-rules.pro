# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class ai.noa.bridge.** { *** Companion; }
-keepclasseswithmembers class ai.noa.bridge.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class ai.noa.bridge.**$$serializer { *; }
