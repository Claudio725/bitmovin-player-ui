import {UIContainer} from './components/uicontainer';
import {DOM} from './dom';
import {Component, ComponentConfig} from './components/component';
import {Container} from './components/container';
import { SeekBar, SeekBarMarker } from './components/seekbar';
import {NoArgs, EventDispatcher, CancelEventArgs} from './eventdispatcher';
import PlayerAPI = bitmovin.PlayerAPI;
import Event = bitmovin.PlayerAPI.Event;
import PlayerEventCallback = bitmovin.PlayerAPI.PlayerEventCallback;
import AdStartedEvent = bitmovin.PlayerAPI.AdStartedEvent;
import PlayerEvent = bitmovin.PlayerAPI.PlayerEvent;
import {UIUtils} from './uiutils';
import {ArrayUtils} from './arrayutils';
import {BrowserUtils} from './browserutils';
import { UIFactory } from './uifactory';
import { TimelineMarker, UIConfig } from './uiconfig';

export interface InternalUIConfig extends UIConfig {
  events: {
    /**
     * Fires when the configuration has been updated/changed.
     */
    onUpdated: EventDispatcher<UIManager, void>;
  };
}

/**
 * The context that will be passed to a {@link UIConditionResolver} to determine if it's conditions fulfil the context.
 */
export interface UIConditionContext {
  /**
   * Tells if the player is loading or playing an ad.
   */
  isAd: boolean;
  /**
   * Tells the ad client (e.g. 'vast, 'ima') if {@link #isAd} is true.
   */
  adClientType: string;
  /**
   * Tells if the player is currently in fullscreen mode.
   */
  isFullscreen: boolean;
  /**
   * Tells if the UI is running in a mobile browser.
   */
  isMobile: boolean;
  /**
   * Tells if the player is in playing or paused state.
   */
  isPlaying: boolean;
  /**
   * The width of the player/UI element.
   */
  width: number;
  /**
   * The width of the document where the player/UI is embedded in.
   */
  documentWidth: number;
}

/**
 * Resolves the conditions of its associated UI in a {@link UIVariant} upon a {@link UIConditionContext} and decides
 * if the UI should be displayed. If it returns true, the UI is a candidate for display; if it returns false, it will
 * not be displayed in the given context.
 */
export interface UIConditionResolver {
  (context: UIConditionContext): boolean;
}

/**
 * Associates a UI instance with an optional {@link UIConditionResolver} that determines if the UI should be displayed.
 */
export interface UIVariant {
  ui: UIContainer;
  condition?: UIConditionResolver;
}

export class UIManager {

  private player: PlayerAPI;
  private uiContainerElement: DOM;
  private uiVariants: UIVariant[];
  private uiInstanceManagers: InternalUIInstanceManager[];
  private currentUi: InternalUIInstanceManager;
  private config: InternalUIConfig;
  private managerPlayerWrapper: PlayerWrapper;

  private events = {
    onUiVariantResolve: new EventDispatcher<UIManager, UIConditionContext>(),
  };

  /**
   * Creates a UI manager with a single UI variant that will be permanently shown.
   * @param player the associated player of this UI
   * @param ui the UI to add to the player
   * @param config optional UI configuration
   */
  constructor(player: PlayerAPI, ui: UIContainer, config?: UIConfig);
  /**
   * Creates a UI manager with a list of UI variants that will be dynamically selected and switched according to
   * the context of the UI.
   *
   * Every time the UI context changes, the conditions of the UI variants will be sequentially resolved and the first
   * UI, whose condition evaluates to true, will be selected and displayed. The last variant in the list might omit the
   * condition resolver and will be selected as default/fallback UI when all other conditions fail. If there is no
   * fallback UI and all conditions fail, no UI will be displayed.
   *
   * @param player the associated player of this UI
   * @param uiVariants a list of UI variants that will be dynamically switched
   * @param config optional UI configuration
   */
  constructor(player: PlayerAPI, uiVariants: UIVariant[], config?: UIConfig);
  constructor(player: PlayerAPI, playerUiOrUiVariants: UIContainer | UIVariant[], config: UIConfig = {}) {
    if (playerUiOrUiVariants instanceof UIContainer) {
      // Single-UI constructor has been called, transform arguments to UIVariant[] signature
      let playerUi = <UIContainer>playerUiOrUiVariants;
      let uiVariants = [];

      // Add the default player UI
      uiVariants.push({ ui: playerUi });

      this.uiVariants = uiVariants;
    }
    else {
      // Default constructor (UIVariant[]) has been called
      this.uiVariants = <UIVariant[]>playerUiOrUiVariants;
    }

    this.player = player;
    this.config = {
      ...config,
      events: {
        onUpdated: new EventDispatcher<UIManager, void>(),
      },
    };
    this.managerPlayerWrapper = new PlayerWrapper(player);

    /**
     * Gathers configuration data from the UI config and player source config and creates a merged UI config
     * that is used throughout the UI instance.
     */
    const updateConfig = () => {
      const playerSourceConfig = player.getSource() || {};

      const uiConfig = { ...config };
      uiConfig.metadata = uiConfig.metadata || {};

      // Extract the UI-related config properties from the source config
      const playerSourceUiConfig: UIConfig = {
        metadata: {
          // TODO move metadata into source.metadata namespace in player v8
          title: playerSourceConfig.title,
          description: playerSourceConfig.description,
          markers: (playerSourceConfig as any).markers,
        },
        recommendations: (playerSourceConfig as any).recommendations,
      };

      // Player source config takes precedence over the UI config, because the config in the source is attached
      // to a source which changes with every player.load, whereas the UI config stays the same for the whole
      // lifetime of the player instance.
      this.config.metadata = this.config.metadata || {};
      this.config.metadata.title = playerSourceUiConfig.metadata.title || uiConfig.metadata.title;
      this.config.metadata.description = playerSourceUiConfig.metadata.description || uiConfig.metadata.description;
      this.config.metadata.markers = playerSourceUiConfig.metadata.markers || uiConfig.metadata.markers || [];
      this.config.recommendations = playerSourceUiConfig.recommendations || uiConfig.recommendations || [];
    };

    updateConfig();

    // Update the configuration when a new source is loaded
    this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.SourceLoaded, () => {
      updateConfig();
      this.config.events.onUpdated.dispatch(this);
    });

    if (config.container) {
      // Unfortunately "uiContainerElement = new DOM(config.container)" will not accept the container with
      // string|HTMLElement type directly, although it accepts both types, so we need to spit these two cases up here.
      // TODO check in upcoming TS versions if the container can be passed in directly, or fix the constructor
      this.uiContainerElement = config.container instanceof HTMLElement ?
        new DOM(config.container) : new DOM(config.container);
    } else {
      this.uiContainerElement = new DOM(player.getContainer());
    }

    // Create UI instance managers for the UI variants
    // The instance managers map to the corresponding UI variants by their array index
    this.uiInstanceManagers = [];
    let uiVariantsWithoutCondition = [];
    for (let uiVariant of this.uiVariants) {
      if (uiVariant.condition == null) {
        // Collect variants without conditions for error checking
        uiVariantsWithoutCondition.push(uiVariant);
      }
      // Create the instance manager for a UI variant
      this.uiInstanceManagers.push(new InternalUIInstanceManager(player, uiVariant.ui, this.config));
    }
    // Make sure that there is only one UI variant without a condition
    // It does not make sense to have multiple variants without condition, because only the first one in the list
    // (the one with the lowest index) will ever be selected.
    if (uiVariantsWithoutCondition.length > 1) {
      throw Error('Too many UIs without a condition: You cannot have more than one default UI');
    }
    // Make sure that the default UI variant, if defined, is at the end of the list (last index)
    // If it comes earlier, the variants with conditions that come afterwards will never be selected because the
    // default variant without a condition always evaluates to 'true'
    if (uiVariantsWithoutCondition.length > 0
      && uiVariantsWithoutCondition[0] !== this.uiVariants[this.uiVariants.length - 1]) {
      throw Error('Invalid UI variant order: the default UI (without condition) must be at the end of the list');
    }

    // Switch on auto UI resolving by default
    if (config.autoUiVariantResolve === undefined) {
      config.autoUiVariantResolve = true;
    }

    let adStartedEvent: AdStartedEvent = null; // keep the event stored here during ad playback

    // Dynamically select a UI variant that matches the current UI condition.
    let resolveUiVariant = (event: PlayerEvent) => {
      // Make sure that the ON_AD_STARTED event data is persisted through ad playback in case other events happen
      // in the meantime, e.g. player resize. We need to store this data because there is no other way to find out
      // ad details (e.g. the ad client) while an ad is playing.
      // Existing event data signals that an ad is currently active. We cannot use player.isAd() because it returns
      // true on ad start and also on ad end events, which is problematic.
      if (event != null) {
        switch (event.type) {
          // When the ad starts, we store the event data
          case player.exports.Event.AdStarted:
            adStartedEvent = <AdStartedEvent>event;
            break;
          // When the ad ends, we delete the event data
          case player.exports.Event.AdFinished:
          case player.exports.Event.AdSkipped:
          case player.exports.Event.AdError:
            adStartedEvent = null;
            break;
          // When a new source is loaded during ad playback, there will be no ad end event so we detect the end
          // of the ad playback by checking isAd().
          case player.exports.Event.SourceLoaded:
            if (adStartedEvent && !player.ads.isLinearAdActive()) {
              adStartedEvent = null;
            }
        }
      }

      // Detect if an ad has started
      let ad = adStartedEvent != null;

      this.resolveUiVariant({
        isAd: ad,
        adClientType: ad ? adStartedEvent.clientType : null,
      }, (context) => {
        // If this is an ad UI, we need to relay the saved ON_AD_STARTED event data so ad components can configure
        // themselves for the current ad.
        if (context.isAd) {
          /* Relay the ON_AD_STARTED event to the ads UI
           *
           * Because the ads UI is initialized in the ON_AD_STARTED handler, i.e. when the ON_AD_STARTED event has
           * already been fired, components in the ads UI that listen for the ON_AD_STARTED event never receive it.
           * Since this can break functionality of components that rely on this event, we relay the event to the
           * ads UI components with the following call.
           */
          this.currentUi.getWrappedPlayer().fireEventInUI(this.player.exports.Event.AdStarted, adStartedEvent);
        }
      });
    };

    // Listen to the following events to trigger UI variant resolution
    if (config.autoUiVariantResolve) {
      this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.SourceLoaded, resolveUiVariant);
      this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.Play, resolveUiVariant);
      this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.Paused, resolveUiVariant);
      this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.AdStarted, resolveUiVariant);
      this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.AdFinished, resolveUiVariant);
      this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.AdSkipped, resolveUiVariant);
      this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.AdError, resolveUiVariant);
      this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.PlayerResized, resolveUiVariant);
      this.managerPlayerWrapper.getPlayer().on(this.player.exports.Event.ViewModeChanged, resolveUiVariant);
    }

    // Initialize the UI
    resolveUiVariant(null);
  }

  getConfig(): UIConfig {
    return this.config;
  }

  /**
   * Returns the list of UI variants as passed into the constructor of {@link UIManager}.
   * @returns {UIVariant[]} the list of available UI variants
   */
  getUiVariants(): UIVariant[] {
    return this.uiVariants;
  }

  /**
   * Switches to a UI variant from the list returned by {@link getUiVariants}.
   * @param {UIVariant} uiVariant the UI variant to switch to
   * @param {() => void} onShow a callback that is executed just before the new UI variant is shown
   */
  switchToUiVariant(uiVariant: UIVariant, onShow?: () => void): void {
    let uiVariantIndex = this.uiVariants.indexOf(uiVariant);

    const nextUi: InternalUIInstanceManager = this.uiInstanceManagers[uiVariantIndex];
    let uiVariantChanged = false;

    // Determine if the UI variant is changing
    if (nextUi !== this.currentUi) {
      uiVariantChanged = true;
      // console.log('switched from ', this.currentUi ? this.currentUi.getUI() : 'none',
      //   ' to ', nextUi ? nextUi.getUI() : 'none');
    }

    // Only if the UI variant is changing, we need to do some stuff. Else we just leave everything as-is.
    if (uiVariantChanged) {
      // Hide the currently active UI variant
      if (this.currentUi) {
        this.currentUi.getUI().hide();
      }

      // Assign the new UI variant as current UI
      this.currentUi = nextUi;

      // When we switch to a different UI instance, there's some additional stuff to manage. If we do not switch
      // to an instance, we're done here.
      if (this.currentUi != null) {
        // Add the UI to the DOM (and configure it) the first time it is selected
        if (!this.currentUi.isConfigured()) {
          this.addUi(this.currentUi);
        }

        if (onShow) {
          onShow();
        }

        this.currentUi.getUI().show();
      }
    }
  }

  /**
   * Triggers a UI variant switch as triggered by events when automatic switching is enabled. It allows to overwrite
   * properties of the {@link UIConditionContext}.
   * @param {Partial<UIConditionContext>} context an optional set of properties that overwrite properties of the
   *   automatically determined context
   * @param {(context: UIConditionContext) => void} onShow a callback that is executed just before the new UI variant
   *   is shown (if a switch is happening)
   */
  resolveUiVariant(context: Partial<UIConditionContext> = {}, onShow?: (context: UIConditionContext) => void): void {
    // Determine the current context for which the UI variant will be resolved
    const defaultContext: UIConditionContext = {
      isAd: false,
      adClientType: null,
      isFullscreen: this.player.getViewMode() === this.player.exports.ViewMode.Fullscreen,
      isMobile: BrowserUtils.isMobile,
      isPlaying: this.player.isPlaying(),
      width: this.uiContainerElement.width(),
      documentWidth: document.body.clientWidth,
    };

    // Overwrite properties of the default context with passed in context properties
    const switchingContext = { ...defaultContext, ...context };

    // Fire the event and allow modification of the context before it is used to resolve the UI variant
    this.events.onUiVariantResolve.dispatch(this, switchingContext);

    let nextUiVariant: UIVariant = null;

    // Select new UI variant
    // If no variant condition is fulfilled, we switch to *no* UI
    for (let uiVariant of this.uiVariants) {
      if (uiVariant.condition == null || uiVariant.condition(switchingContext) === true) {
        nextUiVariant = uiVariant;
        break;
      }
    }

    this.switchToUiVariant(nextUiVariant, () => {
      if (onShow) {
        onShow(switchingContext);
      }
    });
  }

  private addUi(ui: InternalUIInstanceManager): void {
    let dom = ui.getUI().getDomElement();
    let player = ui.getWrappedPlayer();

    ui.configureControls();
    /* Append the UI DOM after configuration to avoid CSS transitions at initialization
     * Example: Components are hidden during configuration and these hides may trigger CSS transitions that are
     * undesirable at this time. */
    this.uiContainerElement.append(dom);

    // Some components initialize their state on SourceLoaded. When the UI is loaded after the source is already loaded,
    // they will never receive the event so we fire it from here in such cases.
    if (player.getSource()) {
      player.fireEventInUI(player.exports.Event.SourceLoaded, {});
    }

    // Fire onConfigured after UI DOM elements are successfully added. When fired immediately, the DOM elements
    // might not be fully configured and e.g. do not have a size.
    // https://swizec.com/blog/how-to-properly-wait-for-dom-elements-to-show-up-in-modern-browsers/swizec/6663
    if (window.requestAnimationFrame) {
      requestAnimationFrame(() => { ui.onConfigured.dispatch(ui.getUI()); });
    } else {
      // IE9 fallback
      setTimeout(() => { ui.onConfigured.dispatch(ui.getUI()); }, 0);
    }
  }

  private releaseUi(ui: InternalUIInstanceManager): void {
    ui.releaseControls();
    ui.getUI().getDomElement().remove();
    ui.clearEventHandlers();
  }

  release(): void {
    for (let uiInstanceManager of this.uiInstanceManagers) {
      this.releaseUi(uiInstanceManager);
    }
    this.managerPlayerWrapper.clearEventHandlers();
  }

  /**
   * Fires just before UI variants are about to be resolved and the UI variant is possibly switched. It is fired when
   * the switch is triggered from an automatic switch and when calling {@link resolveUiVariant}.
   * Can be used to modify the {@link UIConditionContext} before resolving is done.
   * @returns {EventDispatcher<UIManager, UIConditionContext>}
   */
  get onUiVariantResolve(): EventDispatcher<UIManager, UIConditionContext> {
    return this.events.onUiVariantResolve;
  }

  /**
   * Returns the list of all added markers in undefined order.
   */
  getTimelineMarkers(): TimelineMarker[] {
    return this.config.metadata.markers;
  }

  /**
   * Adds a marker to the timeline. Does not check for duplicates/overlaps at the `time`.
   */
  addTimelineMarker(timelineMarker: TimelineMarker): void {
    this.config.metadata.markers.push(timelineMarker);
    this.config.events.onUpdated.dispatch(this);
  }

  /**
   * Removes a marker from the timeline (by reference) and returns `true` if the marker has
   * been part of the timeline and successfully removed, or `false` if the marker could not
   * be found and thus not removed.
   */
  removeTimelineMarker(timelineMarker: TimelineMarker): boolean {
    if (ArrayUtils.remove(this.config.metadata.markers, timelineMarker) === timelineMarker) {
      this.config.events.onUpdated.dispatch(this);
      return true;
    }

    return false;
  }
}

/**
 * Export the {@link UIFactory} as `UIManager.Factory` for backwards compatibility with the UI module in player v8 RCs.
 * @deprecated remove with UI v4
 */
export namespace UIManager {
  export import Factory = UIFactory;
}

export interface SeekPreviewArgs extends NoArgs {
  /**
   * The timeline position in percent where the event originates from.
   */
  position: number;
  /**
   * The timeline marker associated with the current position, if existing.
   */
  marker?: SeekBarMarker;
}

/**
 * Encapsulates functionality to manage a UI instance. Used by the {@link UIManager} to manage multiple UI instances.
 */
export class UIInstanceManager {
  private playerWrapper: PlayerWrapper;
  private ui: UIContainer;
  private config: InternalUIConfig;

  private events = {
    onConfigured: new EventDispatcher<UIContainer, NoArgs>(),
    onSeek: new EventDispatcher<SeekBar, NoArgs>(),
    onSeekPreview: new EventDispatcher<SeekBar, SeekPreviewArgs>(),
    onSeeked: new EventDispatcher<SeekBar, NoArgs>(),
    onComponentShow: new EventDispatcher<Component<ComponentConfig>, NoArgs>(),
    onComponentHide: new EventDispatcher<Component<ComponentConfig>, NoArgs>(),
    onControlsShow: new EventDispatcher<UIContainer, NoArgs>(),
    onPreviewControlsHide: new EventDispatcher<UIContainer, CancelEventArgs>(),
    onControlsHide: new EventDispatcher<UIContainer, NoArgs>(),
    onRelease: new EventDispatcher<UIContainer, NoArgs>(),
  };

  constructor(player: PlayerAPI, ui: UIContainer, config: InternalUIConfig) {
    this.playerWrapper = new PlayerWrapper(player);
    this.ui = ui;
    this.config = config;
  }

  getConfig(): InternalUIConfig {
    return this.config;
  }

  getUI(): UIContainer {
    return this.ui;
  }

  getPlayer(): PlayerAPI {
    return this.playerWrapper.getPlayer();
  }

  /**
   * Fires when the UI is fully configured and added to the DOM.
   * @returns {EventDispatcher}
   */
  get onConfigured(): EventDispatcher<UIContainer, NoArgs> {
    return this.events.onConfigured;
  }

  /**
   * Fires when a seek starts.
   * @returns {EventDispatcher}
   */
  get onSeek(): EventDispatcher<SeekBar, NoArgs> {
    return this.events.onSeek;
  }

  /**
   * Fires when the seek timeline is scrubbed.
   * @returns {EventDispatcher}
   */
  get onSeekPreview(): EventDispatcher<SeekBar, SeekPreviewArgs> {
    return this.events.onSeekPreview;
  }

  /**
   * Fires when a seek is finished.
   * @returns {EventDispatcher}
   */
  get onSeeked(): EventDispatcher<SeekBar, NoArgs> {
    return this.events.onSeeked;
  }

  /**
   * Fires when a component is showing.
   * @returns {EventDispatcher}
   */
  get onComponentShow(): EventDispatcher<Component<ComponentConfig>, NoArgs> {
    return this.events.onComponentShow;
  }

  /**
   * Fires when a component is hiding.
   * @returns {EventDispatcher}
   */
  get onComponentHide(): EventDispatcher<Component<ComponentConfig>, NoArgs> {
    return this.events.onComponentHide;
  }

  /**
   * Fires when the UI controls are showing.
   * @returns {EventDispatcher}
   */
  get onControlsShow(): EventDispatcher<UIContainer, NoArgs> {
    return this.events.onControlsShow;
  }

  /**
   * Fires before the UI controls are hiding to check if they are allowed to hide.
   * @returns {EventDispatcher}
   */
  get onPreviewControlsHide(): EventDispatcher<UIContainer, CancelEventArgs> {
    return this.events.onPreviewControlsHide;
  }

  /**
   * Fires when the UI controls are hiding.
   * @returns {EventDispatcher}
   */
  get onControlsHide(): EventDispatcher<UIContainer, NoArgs> {
    return this.events.onControlsHide;
  }

  /**
   * Fires when the UI controls are released.
   * @returns {EventDispatcher}
   */
  get onRelease(): EventDispatcher<UIContainer, NoArgs> {
    return this.events.onRelease;
  }

  protected clearEventHandlers(): void {
    this.playerWrapper.clearEventHandlers();

    let events = <any>this.events; // avoid TS7017
    for (let event in events) {
      let dispatcher = <EventDispatcher<Object, Object>>events[event];
      dispatcher.unsubscribeAll();
    }
  }
}

/**
 * Extends the {@link UIInstanceManager} for internal use in the {@link UIManager} and provides access to functionality
 * that components receiving a reference to the {@link UIInstanceManager} should not have access to.
 */
class InternalUIInstanceManager extends UIInstanceManager {

  private configured: boolean;
  private released: boolean;

  getWrappedPlayer(): WrappedPlayer {
    // TODO find a non-hacky way to provide the WrappedPlayer to the UIManager without exporting it
    // getPlayer() actually returns the WrappedPlayer but its return type is set to Player so the WrappedPlayer does
    // not need to be exported
    return <WrappedPlayer>this.getPlayer();
  }

  configureControls(): void {
    this.configureControlsTree(this.getUI());
    this.configured = true;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  private configureControlsTree(component: Component<ComponentConfig>) {
    let configuredComponents: Component<ComponentConfig>[] = [];

    UIUtils.traverseTree(component, (component) => {
      // First, check if we have already configured a component, and throw an error if we did. Multiple configuration
      // of the same component leads to unexpected UI behavior. Also, a component that is in the UI tree multiple
      // times hints at a wrong UI structure.
      // We could just skip configuration in such a case and not throw an exception, but enforcing a clean UI tree
      // seems like the better choice.
      for (let configuredComponent of configuredComponents) {
        if (configuredComponent === component) {
          // Write the component to the console to simplify identification of the culprit
          // (e.g. by inspecting the config)
          if (console) {
            console.error('Circular reference in UI tree', component);
          }

          // Additionally throw an error, because this case must not happen and leads to unexpected UI behavior.
          throw Error('Circular reference in UI tree: ' + component.constructor.name);
        }
      }

      component.initialize();
      component.configure(this.getPlayer(), this);
      configuredComponents.push(component);
    });
  }

  releaseControls(): void {
    // Do not call release methods if the components have never been configured; this can result in exceptions
    if (this.configured) {
      this.onRelease.dispatch(this.getUI());
      this.releaseControlsTree(this.getUI());
      this.configured = false;
    }
    this.released = true;
  }

  isReleased(): boolean {
    return this.released;
  }

  private releaseControlsTree(component: Component<ComponentConfig>) {
    component.release();

    if (component instanceof Container) {
      for (let childComponent of component.getComponents()) {
        this.releaseControlsTree(childComponent);
      }
    }
  }

  clearEventHandlers(): void {
    super.clearEventHandlers();
  }
}

/**
 * Extended interface of the {@link Player} for use in the UI.
 */
interface WrappedPlayer extends PlayerAPI {
  /**
   * Fires an event on the player that targets all handlers in the UI but never enters the real player.
   * @param event the event to fire
   * @param data data to send with the event
   */
  fireEventInUI(event: Event, data: {}): void;
}

/**
 * Wraps the player to track event handlers and provide a simple method to remove all registered event
 * handlers from the player.
 */
class PlayerWrapper {

  private player: PlayerAPI;
  private wrapper: WrappedPlayer;

  private eventHandlers: { [eventType: string]: PlayerEventCallback[]; } = {};

  constructor(player: PlayerAPI) {
    this.player = player;

    // Collect all members of the player (public API methods and properties of the player)
    // (Object.getOwnPropertyNames(player) does not work with the player TypeScript class starting in 7.2)
    let members: string[] = [];
    for (let member in player) {
      members.push(member);
    }

    // Split the members into methods and properties
    let methods = <any[]>[];
    let properties = <any[]>[];

    for (let member of members) {
      if (typeof (<any>player)[member] === 'function') {
        methods.push(member);
      } else {
        properties.push(member);
      }
    }

    // Create wrapper object
    let wrapper = <any>{};

    // Add function wrappers for all API methods that do nothing but calling the base method on the player
    for (let method of methods) {
      wrapper[method] = function() {
        // console.log('called ' + member); // track method calls on the player
        return (<any>player)[method].apply(player, arguments);
      };
    }

    // Add all public properties of the player to the wrapper
    for (let property of properties) {
      // Get an eventually existing property descriptor to differentiate between plain properties and properties with
      // getters/setters.
      let propertyDescriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(player, property) ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(player), property);

      // If the property has getters/setters, wrap them accordingly...
      if (propertyDescriptor && (propertyDescriptor.get || propertyDescriptor.set)) {
        Object.defineProperty(wrapper, property, {
          get: () => propertyDescriptor.get.call(player),
          set: (value: any) => propertyDescriptor.set.call(player, value),
        });
      }
      // ... else just transfer the property to the wrapper
      else {
        wrapper[property] = (<any>player)[property];
      }
    }

    // Explicitly add a wrapper method for 'on' that adds added event handlers to the event list
    wrapper.on = (eventType: Event, callback: PlayerEventCallback) => {
      player.on(eventType, callback);

      if (!this.eventHandlers[eventType]) {
        this.eventHandlers[eventType] = [];
      }

      this.eventHandlers[eventType].push(callback);

      return wrapper;
    };

    // Explicitly add a wrapper method for 'off' that removes removed event handlers from the event list
    wrapper.off = (eventType: Event, callback: PlayerEventCallback) => {
      player.off(eventType, callback);

      if (this.eventHandlers[eventType]) {
        ArrayUtils.remove(this.eventHandlers[eventType], callback);
      }

      return wrapper;
    };

    wrapper.fireEventInUI = (event: Event, data: {}) => {
      if (this.eventHandlers[event]) { // check if there are handlers for this event registered
        // Extend the data object with default values to convert it to a {@link PlayerEvent} object.
        let playerEventData = <PlayerEvent>Object.assign({}, {
          timestamp: Date.now(),
          type: event,
          // Add a marker property so the UI can detect UI-internal player events
          uiSourced: true,
        }, data);

        // Execute the registered callbacks
        for (let callback of this.eventHandlers[event]) {
          callback(playerEventData);
        }
      }
    };

    this.wrapper = <WrappedPlayer>wrapper;
  }

  /**
   * Returns a wrapped player object that can be used on place of the normal player object.
   * @returns {WrappedPlayer} a wrapped player
   */
  getPlayer(): WrappedPlayer {
    return this.wrapper;
  }

  /**
   * Clears all registered event handlers from the player that were added through the wrapped player.
   */
  clearEventHandlers(): void {
    for (let eventType in this.eventHandlers) {
      for (let callback of this.eventHandlers[eventType]) {
        this.player.off(eventType as any as PlayerAPI.Event, callback);
      }
    }
  }
}

